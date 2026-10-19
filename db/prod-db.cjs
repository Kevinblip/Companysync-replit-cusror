const { Pool } = require('pg');
const crypto = require('crypto');
const { fetchWithRetry } = require('../lib/fetchWithRetry.cjs');
const tenantGuard = require('../lib/tenantGuard.cjs');
const notificationBell = require('../lib/notificationBell.cjs');
const invoiceCustomerLink = require('../lib/invoiceCustomerLink.cjs');
const invoiceNumbers = require('../lib/invoiceNumbers.cjs');
const rateLimit = require('../lib/rateLimit.cjs');
const chatBot = require('../lib/chatBot.cjs');
const { isRedundantPlatformEstimateWorkflow } = require('../lib/workflowNotificationSafety.cjs');
const { mirroredIdEquality } = require('../lib/paymentListFilter.cjs');

let pool = null;

function getPool() {
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

async function initDatabase() {
  const p = getPool();
  if (require('../lib/stagingSideEffects.cjs').sideEffectsDisabled()) {
    await p.query('SELECT 1 AS staging_db_ok');
    console.log('[staging] database init skipped; connection verified');
    return;
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, name TEXT, company_name TEXT, company_tagline TEXT,
      company_logo TEXT, logo_url TEXT, created_by TEXT, is_deleted BOOLEAN DEFAULT false,
      phone TEXT, email TEXT, address TEXT, website TEXT, industry TEXT DEFAULT 'roofing', timezone TEXT,
      preferred_language TEXT DEFAULT 'en', subscription_plan TEXT,
      stripe_customer_id TEXT, stripe_subscription_id TEXT, trial_end_date TIMESTAMP,
      max_users INTEGER DEFAULT 5, max_leads INTEGER DEFAULT 100,
      ai_credits_purchased INTEGER DEFAULT 0,
      sms_credits_purchased INTEGER DEFAULT 0,
      call_credits_purchased INTEGER DEFAULT 0,
      onboarding_completed BOOLEAN DEFAULT false,
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
      lead_temperature TEXT,
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
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, invoice_id TEXT, customer_id TEXT,
      customer_name TEXT, invoice_number TEXT, payment_number TEXT, amount NUMERIC(12,2) DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS labor_rates (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL,
      rate_cents INTEGER NOT NULL CHECK (rate_cents >= 0), is_active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subcontractor_rates (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, subcontractor_id TEXT NOT NULL,
      labor_rate_id TEXT NOT NULL REFERENCES labor_rates(id) ON DELETE CASCADE,
      custom_rate NUMERIC(12,2) NOT NULL CHECK (custom_rate >= 0),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (subcontractor_id, labor_rate_id)
    );
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL, subcontractor_id TEXT NOT NULL,
      work_order_number TEXT NOT NULL, title TEXT NOT NULL, scope_of_work TEXT,
      payout_cents INTEGER NOT NULL CHECK (payout_cents >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','completed','approved','paid')),
      access_token TEXT NOT NULL UNIQUE, completion_notes TEXT, created_by TEXT,
      accepted_at TIMESTAMP, completed_at TIMESTAMP, approved_at TIMESTAMP, paid_at TIMESTAMP,
      invite_delivery_method TEXT, invite_delivery_status TEXT, invite_delivered_at TIMESTAMP,
      invite_delivery_error TEXT,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS work_order_items (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL, labor_rate_id TEXT NOT NULL REFERENCES labor_rates(id),
      description TEXT NOT NULL, unit TEXT NOT NULL, quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit_rate_cents INTEGER NOT NULL CHECK (unit_rate_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0), created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS work_order_completion_photos (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL, file_url TEXT NOT NULL, original_filename TEXT, mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK (file_size > 0), created_at TIMESTAMP DEFAULT NOW()
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
      status TEXT DEFAULT 'scheduled', google_event_id TEXT, outlook_event_id TEXT,
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
      ai_summary TEXT, sentiment TEXT, intent TEXT, duration_minutes INTEGER,
      is_read BOOLEAN DEFAULT false, lead_id TEXT, customer_id TEXT, created_by TEXT,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
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
      phone_number TEXT PRIMARY KEY, company_id TEXT, company_name TEXT,
      assistant_name TEXT DEFAULT 'Alex', routing_mode TEXT DEFAULT 'sarah_answers',
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

  // Project-gallery crew-share bridge. Keep this migration here as well as in
  // db/schema.js so the production and development initialization paths agree.
  await p.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'standard';
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_milestone TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS related_customer_id TEXT;
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
    ALTER TABLE project_photos ALTER COLUMN is_public SET DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_project_photos_project ON project_photos(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_photos_public ON project_photos(project_id, is_public);
    CREATE INDEX IF NOT EXISTS idx_project_photos_source_customer
      ON project_photos(company_id, source_customer_id, project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_photos_source_media
      ON project_photos(project_id, source_media_id)
      WHERE source_media_id IS NOT NULL;
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
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_credits_purchased INTEGER DEFAULT 0;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_credits_purchased INTEGER DEFAULT 0;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS call_credits_purchased INTEGER DEFAULT 0;
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS google_event_id TEXT;
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS outlook_event_id TEXT;
      ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS leaderboard_digest_email BOOLEAN DEFAULT true;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE companies credits skipped:', err.message);
  }

  await p.query(`
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivery_method TEXT;
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivery_status TEXT;
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivered_at TIMESTAMP;
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivery_error TEXT;
  `);

  // One-time guarded migration: onboarding_completed gates dashboard access for
  // NEW companies (default false → routed to Quick Setup). Companies that
  // existed before this column was added are grandfathered to true so nobody
  // gets locked out. The UPDATE runs ONLY when the column is first created —
  // never as a repeating startup backfill (a repeating UPDATE would flip new
  // pending companies to true and defeat the gate). Keep in lockstep with
  // db/schema.js (dev).
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
  // JSONB value looks like a date. (Task #672)
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
  // audit trail of every paid credit purchase. Must stay in lockstep with
  // db/schema.js. session_id is UNIQUE so a webhook retry can never
  // double-grant credits.
  try {
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
  } catch (err) {
    console.warn('[DB] CREATE TABLE credit_grants skipped:', err.message);
  }

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

  // Google Calendar reconnect flag: true when tokens are cleared due to invalid_grant
  // (revoked/expired refresh token — e.g. OAuth app in Testing mode → 7-day expiry).
  // Cleared automatically on successful reconnect. Surfaced via checkUserGoogleCalendarConnection
  // so the Calendar page can show a proactive "Reconnect" banner instead of a silent
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

  try {
    await p.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS adjuster_name TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS adjuster_phone TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_source TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_source TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_to_users JSONB DEFAULT '[]';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS insurance_company TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(12,2) DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_token TEXT;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE customers skipped:', err.message);
  }

  try {
    await p.query(`
      ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS customer_id TEXT;
      ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS lead_id TEXT;
      ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS html_content TEXT;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE signing_sessions (customer_id/lead_id) skipped:', err.message);
  }

  try {
    await p.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quickbooks_invoice_id TEXT;`);
  } catch (err) {
    console.warn('[DB] ALTER TABLE invoices (quickbooks_invoice_id) skipped:', err.message);
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
    );
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
    ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'::jsonb;
  `);

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

    ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_number TEXT;

    CREATE INDEX IF NOT EXISTS idx_generic_entity_type ON generic_entities(entity_type);
    -- Self-heal: an older deploy created idx_generic_company on (company_id) only.
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
    -- Do NOT add uq_invoices_company_invoice_number here. Startup schema init
    -- would fail while duplicate numbers exist (INV-2026-0385 on two YICN
    -- customers). The unique index lives in
    -- db/migrations/20261017_invoice_number_unique.sql and is applied by hand.
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
    CREATE INDEX IF NOT EXISTS idx_call_routing ON call_routing_cache(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_token ON signing_sessions(signing_token);
    CREATE INDEX IF NOT EXISTS idx_chat_conv_company ON chat_conversations(company_id);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_company ON chat_messages(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_company ON signing_sessions(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_base44 ON signing_sessions(base44_session_id);
    CREATE INDEX IF NOT EXISTS idx_pending_signups_token ON pending_signups(verification_token);
    CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(email);
  `);

  console.log('[DB] Production database schema initialized');


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
      await patchMissingOpTemplates(p);
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
    // Use the same index names as db/schema.js so dev and prod stay in sync
    // and Replit's publish migration doesn't flag them as extra.
    await p.query(`CREATE INDEX IF NOT EXISTS idx_impersonation_logs_company ON impersonation_logs (target_company_id)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_impersonation_logs_admin ON impersonation_logs (admin_email)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_impersonation_logs_active ON impersonation_logs (is_active) WHERE is_active = true`);
    // Drop old short-named indexes if they exist (left over from an earlier naming convention)
    await p.query(`DROP INDEX IF EXISTS idx_imp_logs_company`).catch(() => {});
    await p.query(`DROP INDEX IF EXISTS idx_imp_logs_admin`).catch(() => {});
    await p.query(`DROP INDEX IF EXISTS idx_imp_logs_active`).catch(() => {});
    await p.query(`ALTER TABLE impersonation_logs ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'impersonation'`);
  } catch (err) {
    console.error('[Init] Error creating impersonation_logs table:', err.message);
  }

  // Leads: extra columns added after initial schema
  try {
    await p.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT false`);
    await p.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contractor_decision TEXT`);
    await p.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS claim_number TEXT`);
    await p.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS referred_by TEXT`);
    await p.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}'`);
    await p.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_temperature TEXT`);
  } catch (err) {
    console.warn('[DB] ALTER TABLE leads (extra columns) skipped:', err.message);
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
      )
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_staff_score_events_company ON staff_score_events(company_id)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_staff_score_events_staff ON staff_score_events(company_id, staff_email)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_staff_score_events_created ON staff_score_events(created_at DESC)`);
  } catch (err) {
    console.warn('[DB] staff_score_events table skipped:', err.message);
  }

  // Seed a platform super-admin only when none exists. Password comes from
  // SUPER_ADMIN_PASSWORD and an existing account is never overwritten.
  try {
    const { ensureSuperAdmin } = require('../lib/superAdminSeed.cjs');
    await ensureSuperAdmin(p);
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
    companies: ['name', 'company_name', 'company_tagline', 'company_logo', 'logo_url', 'created_by', 'is_deleted', 'phone', 'email', 'address', 'preferred_language', 'subscription_plan', 'ai_credits_purchased', 'sms_credits_purchased', 'call_credits_purchased'],
  };

  const fields = ENTITY_FIELDS[entityType];
  if (!fields) return { synced: 0, errors: 0 };

  let synced = 0, errors = 0;
  for (const rawRecord of records) {
    try {
      // Sync has no authenticated caller, so it can never decide a change
      // order. Anything it imports lands pending and must be approved in-app.
      const record = tenantGuard.sanitizeChangeOrderOnCreate(null, entityType, rawRecord, 'syncEntityBatch');
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
// Server-owned safety/audit entities must never be visible or mutable through
// the generic tenant entity API.
const INTERNAL_ENTITY_TYPES = new Set(['EmailRateLimit', 'EmailDeliveryEvent', 'EmailProviderStatus', 'InsuranceClaimWelcomeEmailSend']);

function isInternalEntityType(entityType) {
  return INTERNAL_ENTITY_TYPES.has(entityType);
}

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

// Query-string filter values always arrive as strings. Only operator objects
// ({$in:[...]}, {$contains:'x'}) and arrays are real JSON — everything else must
// stay a raw string. Blindly JSON.parse-ing turns a stored literal like "null"
// or "true" into a real null/boolean, and a null value widens the clause to
// "IS NULL OR = ''", silently returning every row with an empty column.
// The SDK drops null/undefined filter values before they reach the wire, so a
// bare "null" here is always junk text, never an intentional IS-NULL filter.
function parseFilterValue(v) {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch (_) { return v; }
  }
  return v;
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
  if (isNumericCol && Array.isArray(val)) return val.length > 0 ? val[0] : null;
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
    // Remap created_date → created_at for dedicated tables. Dedicated tables
    // store the timestamp in created_at; created_date is the SDK-level alias.
    const normalizedKey = (key === 'created_date' && tableColumns && tableColumns.has('created_at')) ? 'created_at' : key;
    const isDirectCol = !tableColumns || tableColumns.has(normalizedKey);
    const colRef = isDirectCol ? `"${normalizedKey}"` : `data->>'${key}'`;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (val.$ne !== undefined) { if (val.$ne === null) { clauses.push(`${colRef} IS NOT NULL`); } else { clauses.push(`${colRef} != $${idx}`); values.push(isDirectCol ? val.$ne : String(val.$ne)); idx++; } }
      if (val.$in && Array.isArray(val.$in)) { const ph = val.$in.map((_, i) => `$${idx + i}`); clauses.push(`${colRef} IN (${ph.join(',')})`); values.push(...val.$in.map(v => isDirectCol ? v : String(v))); idx += val.$in.length; }
      if (val.$contains !== undefined) { clauses.push(`${colRef} ILIKE $${idx}`); values.push(`%${val.$contains}%`); idx++; }
      if (val.$gt !== undefined) { if (isDirectCol) { clauses.push(`"${normalizedKey}" > $${idx}`); values.push(val.$gt); } else { clauses.push(`(data->>'${key}')::numeric > $${idx}`); values.push(Number(val.$gt)); } idx++; }
      if (val.$gte !== undefined) { if (isDirectCol) { clauses.push(`"${normalizedKey}" >= $${idx}`); values.push(val.$gte); } else { clauses.push(`(data->>'${key}')::numeric >= $${idx}`); values.push(Number(val.$gte)); } idx++; }
      if (val.$lt !== undefined) { if (isDirectCol) { clauses.push(`"${normalizedKey}" < $${idx}`); values.push(val.$lt); } else { clauses.push(`(data->>'${key}')::numeric < $${idx}`); values.push(Number(val.$lt)); } idx++; }
      if (val.$lte !== undefined) { if (isDirectCol) { clauses.push(`"${normalizedKey}" <= $${idx}`); values.push(val.$lte); } else { clauses.push(`(data->>'${key}')::numeric <= $${idx}`); values.push(Number(val.$lte)); } idx++; }
    } else {
      if (val === null) { clauses.push(`(${colRef} IS NULL OR ${colRef} = '')`); }
      else if (isDirectCol) {
        const equality = mirroredIdEquality(normalizedKey, `$${idx}`, {
          hasDataColumn: Boolean(tableColumns && tableColumns.has('data')),
        });
        clauses.push(equality.sql);
        values.push(equality.asText ? String(val) : val);
        idx++;
      } else { clauses.push(`${colRef} = $${idx}`); values.push(String(val)); idx++; }
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

// company_id may arrive as a scalar, a Mongo-style operator object like {$in:[...]},
// or a JSON string of that object (depending on how the caller serialized it).
// Normalize it to either a scalar or a parsed operator object.
function normalizeCompanyId(companyId) {
  if (typeof companyId === 'string' && companyId.startsWith('{')) {
    try { return JSON.parse(companyId); } catch (_) { return companyId; }
  }
  return companyId;
}

// Build a WHERE fragment for company_id supporting a scalar value or a {$in:[...]}
// operator object. Returns parts to be AND-joined with the rest of the query.
function buildCompanyIdWhere(companyField, companyId, startIdx) {
  let idx = startIdx;
  const parts = [];
  const values = [];
  const isOp = companyId && typeof companyId === 'object' && !Array.isArray(companyId);
  if (isOp && Array.isArray(companyId.$in)) {
    if (companyId.$in.length === 0) {
      parts.push('FALSE');
    } else {
      const ph = companyId.$in.map((_, i) => `$${idx + i}`);
      parts.push(`${companyField} IN (${ph.join(', ')})`);
      values.push(...companyId.$in.map(String));
      idx += companyId.$in.length;
    }
  } else {
    parts.push(`${companyField} = $${idx}`);
    values.push(isOp ? String(Object.values(companyId)[0]) : companyId);
    idx++;
  }
  return { parts, values, nextIdx: idx };
}

async function universalFilter(p, entityType, filters, sort, limit) {
  const companyId = normalizeCompanyId(filters.company_id);
  const { column: sortCol, direction: sortDir } = parseSortParam(sort);
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(p, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));
    const filterCopy = { ...filters }; delete filterCopy.company_id;
    const whereParts = []; const values = []; let idx = 1;
    if (companyId) {
      const field = tableInfo.companyField === 'id' ? 'id' : tableInfo.companyField;
      const cw = buildCompanyIdWhere(field, companyId, idx);
      whereParts.push(...cw.parts); values.push(...cw.values); idx = cw.nextIdx;
    }
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
  if (companyId) {
    const cw = buildCompanyIdWhere('company_id', companyId, idx);
    whereParts.push(...cw.parts); values.push(...cw.values); idx = cw.nextIdx;
  }
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

// ── Double-booking guard (mirrors vite-db-plugin.js exactly) ───────────────
async function checkCalendarBookingConflict(pool, data, excludeId = null) {
  const { company_id, assigned_to, related_customer, related_lead, start_time, end_time, status } = data;
  if (!start_time || !end_time || !company_id) return null;
  if (status === 'cancelled' || status === 'tentative') return null;
  const fmt = (t) => { try { return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); } catch { return String(t); } };

  // 1. Staff conflict
  if (assigned_to) {
    const params = [company_id, assigned_to, start_time, end_time];
    if (excludeId) params.push(excludeId);
    const { rows } = await pool.query(`
      SELECT id, title, start_time, end_time FROM calendar_events
      WHERE company_id = $1 AND assigned_to = $2
        AND COALESCE(status,'') NOT IN ('cancelled','tentative')
        AND start_time < $4 AND end_time > $3
        ${excludeId ? `AND id::text != $5::text` : ''}
      LIMIT 1`, params);
    if (rows.length > 0) {
      const ev = rows[0];
      return { conflict: true, type: 'staff',
        message: `${assigned_to} is already booked for "${ev.title}" from ${fmt(ev.start_time)} to ${fmt(ev.end_time)}. Choose a different time or assignee.`,
        existing: { id: ev.id, title: ev.title, start_time: ev.start_time, end_time: ev.end_time } };
    }
  }

  // 2. Contact conflict (customer or lead already has an appointment at this time)
  if (related_customer || related_lead) {
    const params = [company_id, start_time, end_time];
    const clauses = [];
    if (related_customer) { params.push(related_customer); clauses.push(`related_customer = $${params.length}`); }
    if (related_lead)     { params.push(related_lead);     clauses.push(`related_lead = $${params.length}`); }
    if (excludeId) params.push(excludeId);
    const { rows } = await pool.query(`
      SELECT id, title, start_time, end_time FROM calendar_events
      WHERE company_id = $1 AND (${clauses.join(' OR ')})
        AND COALESCE(status,'') NOT IN ('cancelled','tentative')
        AND start_time < $3 AND end_time > $2
        ${excludeId ? `AND id::text != $${params.length}::text` : ''}
      LIMIT 1`, params);
    if (rows.length > 0) {
      const ev = rows[0];
      return { conflict: true, type: 'customer',
        message: `This contact already has "${ev.title}" at that time (${fmt(ev.start_time)} – ${fmt(ev.end_time)}). Choose a different time.`,
        existing: { id: ev.id, title: ev.title, start_time: ev.start_time, end_time: ev.end_time } };
    }
  }
  return null;
}

// Pure synchronous intra-payload check: detects conflicts among items in the same bulk request.
function checkIntraPayloadCalendarConflict(seen, item) {
  const { assigned_to, related_customer, related_lead, start_time, end_time, status } = item;
  if (status === 'cancelled' || status === 'tentative') return null;
  if (!start_time || !end_time) return null;
  const newStart = new Date(start_time).getTime();
  const newEnd   = new Date(end_time).getTime();
  if (isNaN(newStart) || isNaN(newEnd) || newEnd <= newStart) return null;
  const fmt = (t) => { try { return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); } catch { return String(t); } };
  for (const prev of seen) {
    if (prev.status === 'cancelled' || prev.status === 'tentative') continue;
    const pStart = new Date(prev.start_time).getTime();
    const pEnd   = new Date(prev.end_time).getTime();
    const overlaps = newStart < pEnd && newEnd > pStart;
    if (!overlaps) continue;
    if (assigned_to && prev.assigned_to && assigned_to === prev.assigned_to)
      return { conflict: true, type: 'staff', message: `${assigned_to} would be double-booked within this batch: "${prev.title || 'event'}" overlaps ${fmt(start_time)}–${fmt(end_time)}.`, existing: prev };
    if (related_customer && prev.related_customer && related_customer === prev.related_customer)
      return { conflict: true, type: 'customer', message: `This contact already has an event in this batch that overlaps ${fmt(start_time)}–${fmt(end_time)}.`, existing: prev };
    if (related_lead && prev.related_lead && related_lead === prev.related_lead)
      return { conflict: true, type: 'customer', message: `This contact already has an event in this batch that overlaps ${fmt(start_time)}–${fmt(end_time)}.`, existing: prev };
  }
  return null;
}
// ── Server-side entity creation count limits ─────────────────────────────────
// Hard server gate for staff/customer/lead count limits.  The React UI already
// hides the "Add" button at cap, but a direct API call would bypass that.
// Exempt: super-admins, companies with subscription_override, unlimited plans.
//
// ⚠  LOCKSTEP: this function is duplicated in BOTH vite-db-plugin.js (dev) AND
//    db/prod-db.cjs (prod).  Any change here MUST be mirrored there.
const _ENTITY_PLAN_LIMITS = {
  basic:        { max_users: 5,  max_customers: 100,    max_leads: 100 },
  business:     { max_users: 10, max_customers: 1000,   max_leads: 1000 },
  enterprise:   { max_users: 25, max_customers: 999999, max_leads: 999999 },
  professional: { max_users: 10, max_customers: 1000,   max_leads: 1000 },
  freelance:    { max_users: 5,  max_customers: 100,    max_leads: 100 },
  starter:      { max_users: 5,  max_customers: 100,    max_leads: 100 },
  trial:        { max_users: 5,  max_customers: 100,    max_leads: 100 },
  legacy:       { max_users: 25, max_customers: 999999, max_leads: 999999 },
  lifetime:     { max_users: 25, max_customers: 999999, max_leads: 999999 },
  unlimited:    { max_users: 25, max_customers: 999999, max_leads: 999999 },
};

async function checkEntityCreationLimit(pool, entityType, companyId, isSuperAdmin, countNeeded) {
  if (isSuperAdmin) return { allowed: true };
  if (!companyId || companyId === 'companysync_master_001') return { allowed: true };
  if (entityType !== 'staff_profiles' && entityType !== 'customers' && entityType !== 'leads') {
    return { allowed: true };
  }
  try {
    const compRes = await pool.query(
      `SELECT subscription_plan, max_users, max_leads,
              COALESCE((data->>'max_customers')::integer, 0) AS max_customers_data,
              COALESCE((data->>'subscription_override')::boolean, false) AS subscription_override
       FROM companies WHERE id = $1`,
      [companyId]
    );
    const company = compRes.rows[0];
    if (!company) return { allowed: true };
    if (company.subscription_override) return { allowed: true };

    const plan = String(company.subscription_plan || 'trial').toLowerCase();
    const planLimits = _ENTITY_PLAN_LIMITS[plan] || _ENTITY_PLAN_LIMITS.basic;
    const n = countNeeded || 1;

    if (entityType === 'staff_profiles') {
      // Plan-level unlimited always wins — don't let a stale column cap an unlimited-tier company
      if (planLimits.max_users >= 999999) return { allowed: true };
      const limit = (company.max_users > 0) ? company.max_users : planLimits.max_users;
      if (limit >= 999999) return { allowed: true };
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM staff_profiles WHERE company_id = $1 AND is_active = true`,
        [companyId]
      );
      const count = parseInt(rows[0]?.cnt || 0);
      if (count + n > limit) {
        return { allowed: false, error: `Staff limit reached for your plan (${count}/${limit} members). Upgrade your plan to add more team members.` };
      }
    } else if (entityType === 'customers') {
      if (planLimits.max_customers >= 999999) return { allowed: true };
      const limit = (company.max_customers_data > 0) ? company.max_customers_data : planLimits.max_customers;
      if (limit >= 999999) return { allowed: true };
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM customers WHERE company_id = $1`,
        [companyId]
      );
      const count = parseInt(rows[0]?.cnt || 0);
      if (count + n > limit) {
        return { allowed: false, error: `Customer limit reached for your plan (${count}/${limit} customers). Upgrade your plan to add more customers.` };
      }
    } else if (entityType === 'leads') {
      if (planLimits.max_leads >= 999999) return { allowed: true };
      const limit = (company.max_leads > 0) ? company.max_leads : planLimits.max_leads;
      if (limit >= 999999) return { allowed: true };
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM leads WHERE company_id = $1`,
        [companyId]
      );
      const count = parseInt(rows[0]?.cnt || 0);
      if (count + n > limit) {
        return { allowed: false, error: `Lead limit reached for your plan (${count}/${limit} leads). Upgrade your plan to add more leads.` };
      }
    }
    return { allowed: true };
  } catch (e) {
    // Fail open on DB errors so a transient outage never blocks a legitimate create.
    console.error('[EntityLimit] checkEntityCreationLimit error (failing open):', e.message);
    return { allowed: true };
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function universalCreate(p, entityType, data) {
  const guarded = (entityType === 'invoices' || entityType === 'payments')
    && data?.company_id
    && typeof p.connect === 'function';
  if (!guarded) return universalCreateUnlocked(p, entityType, data);
  return invoiceNumbers.withInvoiceWriteTransaction(p, async (client) => {
    await invoiceNumbers.prepareEntityWrite(client, entityType, data);
    return universalCreateUnlocked(client, entityType, data);
  });
}

async function universalCreateUnlocked(p, entityType, data) {
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
    const updates = []; const values = []; const extraData = {}; const usedCols = new Set(); let idx = 1; let explicitData = null;
    for (const [key, val] of Object.entries(data)) {
      if (key === 'id' || key === 'created_date' || key === 'created_at' || key === 'updated_at' || key === 'updated_date') continue;
      if (key === 'data') { if (val && typeof val === 'object' && !Array.isArray(val)) explicitData = val; continue; }
      if (tableColumns.has(key)) {
        if (usedCols.has(key)) continue;
        usedCols.add(key);
        const sanitized = sanitizeValueForColumn(key, val, columnDataTypes);
        updates.push(`"${key}" = $${idx}`);
        if (sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)) values.push(JSON.stringify(sanitized));
        else if (Array.isArray(sanitized)) values.push(JSON.stringify(sanitized));
        else values.push(sanitized);
        idx++;
      } else { extraData[key] = val; }
    }
    const mergedJsonb = { ...(explicitData || {}), ...extraData };
    if (Object.keys(mergedJsonb).length > 0 && tableColumns.has('data')) { updates.push(`data = COALESCE(data, '{}')::jsonb || $${idx}::jsonb`); values.push(JSON.stringify(mergedJsonb)); idx++; }
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

function encryptApiKey(rawKey) {
  return require('../lib/encryption.cjs').encryptApiKey(rawKey);
}

function decryptApiKey(encrypted) {
  return require('../lib/encryption.cjs').decryptApiKey(encrypted);
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
    {
      format_name: 'Xactimate Standard (O&P)',
      category: 'insurance', insurance_company: 'Multi-Carrier',
      description: 'Xactimate-compatible format with O&P as a dedicated per-line column. Columns: Qty | Unit | Tax | O&P | RCV | Dep% | ACV. Matches Nationwide, State Farm, and other Xactimate carriers.',
      columns: 9, column_headers: ['Description', 'Qty', 'Unit', 'Tax', 'O&P', 'RCV', 'Dep%', 'ACV'],
      show_rcv_acv: true, show_depreciation: true, show_age_life: false,
      show_op_column: true,
      rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 20,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: true,
      header_text: isYICN ? 'YICN Roofing 216-999-6222' : `${co}`,
      footer_text: 'ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.',
      page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true,
    },
    {
      format_name: 'Symbility Standard (O&P)',
      category: 'insurance', insurance_company: 'Multi-Carrier',
      description: 'Symbility-compatible format with O&P as a dedicated per-line column. Columns: Qty | Unit Price | O&P | Taxes | RC | Depreciation | ACV. Matches Liberty Mutual, Safeco, and Erie carriers using Symbility.',
      columns: 9, column_headers: ['Description', 'Qty', 'Unit Price', 'O&P', 'Taxes', 'RC', 'Depreciation', 'ACV'],
      show_rcv_acv: true, show_depreciation: true, show_age_life: false,
      show_op_column: true,
      rcv_label: 'RC', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 20,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: true,
      header_text: isYICN ? 'YICN Roofing 216-999-6222' : `${co}`,
      footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO YOUR INSURED PROPERTY AND MAY BE REVISED AS WE CONTINUE TO EVALUATE YOUR CLAIM.',
      page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true,
    },
  ];
}

async function patchMissingOpTemplates(pool) {
  try {
    const companiesResult = await pool.query(
      "SELECT DISTINCT company_id FROM generic_entities WHERE entity_type = 'EstimateFormat'"
    );
    let added = 0;
    for (const row of companiesResult.rows) {
      const companyId = row.company_id;
      const companyRow = await pool.query('SELECT company_name FROM companies WHERE id = $1 LIMIT 1', [companyId]);
      const companyName = companyRow.rows[0]?.company_name || companyId;
      const opTemplates = getDefaultTemplates(companyId, companyName).filter(t => t.show_op_column === true);
      for (const tmpl of opTemplates) {
        const existing = await pool.query(
          "SELECT id FROM generic_entities WHERE entity_type = 'EstimateFormat' AND company_id = $1 AND data->>'format_name' = $2 LIMIT 1",
          [companyId, tmpl.format_name]
        );
        if (existing.rows.length === 0) {
          const id = `tmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await pool.query(
            "INSERT INTO generic_entities (id, company_id, entity_type, data, created_date, updated_date) VALUES ($1, $2, 'EstimateFormat', $3, NOW(), NOW())",
            [id, companyId, JSON.stringify({ ...tmpl, company_id: companyId })]
          );
          added++;
          console.log(`[Templates] Added "${tmpl.format_name}" to company ${companyId}`);
        }
      }
    }
    if (added > 0) console.log(`[Templates] Patch complete: added ${added} O&P template(s) to existing companies`);
  } catch (err) {
    console.error('[Templates] patchMissingOpTemplates error:', err.message);
  }
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
      // Payment has its own per-recipient atomic claim and channel audit.
      return null;
    case 'Estimate': {
      const { appendToken } = require('../lib/estimateToken.cjs');
      const _eid = entityData?.id || '';
      return {
        title: `📄 New Estimate ${entityData?.estimate_number || ''}`,
        message: `For ${entityData?.customer_name || 'Unknown'} — $${Number(entityData?.amount || 0).toFixed(2)}`,
        type: 'estimate_created',
        link_url: appendToken(`/ViewEstimate?id=${_eid}`, _eid),
      };
    }
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

      if (require('../lib/emailTransport.cjs').activeProvider() !== 'none') {
        require('../lib/emailTransport.cjs').sendPlatformEmail({
          to: [member.user_email],
          from: 'CompanySync <noreply@companysync.io>',
          subject: config.title,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>${config.title}</h2><p>${config.message}</p>${config.link_url ? `<a href="https://getcompanysync.com${config.link_url}" style="display:inline-block;background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;text-decoration:none">View in CompanySync</a>` : ''}</div>`,
        }).then(() => console.log(`[Notif] Email sent to ${member.user_email}`))
          .catch(e => console.warn(`[Notif] Email error:`, e.message));
      }
    }
  } catch (err) {
    console.warn('[Notif] notifyAdminsForEntity error:', err.message);
  }
}

const CREATE_TRIGGER_MAP = {
  Lead: 'lead_created', Customer: 'customer_created', Estimate: 'estimate_created',
  Invoice: 'invoice_created', Project: 'project_created', Task: 'task_created',
  CalendarEvent: 'appointment_created', Appointment: 'appointment_created',
  Proposal: 'proposal_created', Payment: 'payment_received',
  InspectionJob: 'inspection_scheduled',
};

const UPDATE_TRIGGER_MAP = {
  Estimate: (d) => d.status === 'sent' ? 'estimate_sent' : d.status === 'accepted' ? 'estimate_accepted' : d.status === 'declined' ? 'estimate_declined' : null,
  Invoice: (d) => d.status === 'paid' ? 'invoice_paid' : d.status === 'overdue' ? 'invoice_overdue' : d.status === 'sent' ? 'invoice_sent' : null,
  Task: (d) => d.status === 'completed' ? 'job_completed' : d.assigned_to || d.assignees?.length ? 'task_assigned' : null,
  Job: (d) => d.status === 'completed' ? 'job_completed' : null,
  Appointment: (d) => d.status === 'completed' ? 'appointment_completed' : d.status === 'scheduled' ? 'inspection_scheduled' : null,
  CalendarEvent: (d) => d.status === 'completed' ? 'appointment_completed' : d.status === 'scheduled' ? 'inspection_scheduled' : null,
  Campaign: (d) => d.status === 'sent' ? 'campaign_sent' : null,
  Project: (d) => d.status === 'completed' ? 'job_completed' : d.status === 'in_progress' || d.status === 'started' ? 'project_started' : d.status === 'active' ? 'project_created' : null,
  Lead: (d) => d.status ? 'lead_status_changed' : null,
  InspectionJob: (d) => d.status === 'completed' || d.completed_at ? 'inspection_completed' : d.assigned_to_email ? 'inspection_assigned' : null,
};

const WORKFLOW_TRIGGER_ALIASES = {
  project_completed: ['project_completed', 'job_completed'],
  job_completed: ['job_completed', 'project_completed'],
  inspection_scheduled: ['inspection_scheduled', 'appointment_created'],
  appointment_created: ['appointment_created', 'inspection_scheduled'],
  inspection_completed: ['inspection_completed', 'appointment_completed'],
  appointment_completed: ['appointment_completed', 'inspection_completed'],
};

function workflowTriggerTypes(triggerType) {
  const normalized = String(triggerType || '').trim();
  return WORKFLOW_TRIGGER_ALIASES[normalized] || [normalized];
}

async function fireWorkflowTriggersAsync(pool, sdkName, mutationType, entityId, entityData, companyId, previousEntityData = null) {
  if (!companyId) return;
  if (sdkName === 'Project' || sdkName === 'Customer') {
    const welcome = require('../lib/insuranceClaimWelcome.cjs');
    const integrations = require('./prod-integrations.cjs');
    welcome.sendInsuranceClaimWelcomeEmail({
      pool, companyId, projectId: entityId, mutationType, previousProject: previousEntityData,
      previousCustomer: previousEntityData, entityType: sdkName,
      executeEmail: ({ action, entityData, companyId, entityType, entityId }) =>
        integrations.executeProdWorkflowAction(pool, action, entityData, companyId, entityType, entityId),
    }).then(result => {
      if (result.reason && result.skipped !== true) console.warn('[Insurance welcome]', result.reason);
    }).catch(error => console.warn('[Insurance welcome]', error.message));
  }
  // Withheld-fee offset payments must not fire payment_received workflows
  if (sdkName === 'Payment' && (
    entityData?.is_withheld_offset === true || entityData?.data?.is_withheld_offset === true
    || /no cash received/i.test(entityData?.notes || '')
  )) return;
  try {
    let triggerType = null;
    if (mutationType === 'create') triggerType = CREATE_TRIGGER_MAP[sdkName];
    else if (mutationType === 'update' && UPDATE_TRIGGER_MAP[sdkName]) triggerType = UPDATE_TRIGGER_MAP[sdkName](entityData);
    if (!triggerType) return;

    console.log(`[Workflows] Checking trigger: ${triggerType} for ${companyId}`);

    const { rows: workflows } = await pool.query(
      `SELECT * FROM generic_entities
         WHERE entity_type = 'Workflow'
           AND company_id = $1
           AND data->>'trigger_type' = ANY($2::text[])
           AND (data->>'is_active')::text = 'true'`,
      [companyId, workflowTriggerTypes(triggerType)]
    );
    if (workflows.length === 0) return;

    // Reuse the shared executor (vite-functions-plugin executeWorkflowAction) so prod
    // resolves recipients, templates, email + SMS identically to dev.
    const prodIntegrations = require('./prod-integrations.cjs');
    for (const wfRow of workflows) {
      try {
        const wf = typeof wfRow.data === 'string' ? JSON.parse(wfRow.data) : (wfRow.data || {});
        if (isRedundantPlatformEstimateWorkflow(wf, wfRow.id)) {
          console.log(`[Workflows] Skipping redundant platform workflow ${wfRow.id}`);
          continue;
        }
        const actions = wf.actions || wf.steps || [];
        if (actions.length === 0) continue;

        let currentStep = actions.length; // default: all steps ran immediately
        // Run leading immediate steps; stop at the first delayed / wait step.
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          const aType = action.action_type || action.type;
          const delay = action.delay_minutes || action.config?.delay_minutes || 0;
          if (delay > 0 || aType === 'wait' || aType === 'delay') {
            currentStep = i;
            break;
          }
          try {
            const actionResult = await prodIntegrations.executeProdWorkflowAction(pool, action, entityData, companyId, sdkName, entityId);
            if (actionResult && actionResult.success === false) {
              console.warn(`[Workflows] Step ${i} (${aType}) did not complete:`, actionResult.reason);
            }
          } catch (stepErr) {
            console.warn(`[Workflows] Step ${i} (${aType}) failed:`, stepErr.message);
          }
        }

        // Queue the first delayed step (if any) so the workflow-queue cron continues it later.
        if (currentStep < actions.length) {
          const action = actions[currentStep];
          const aType = action.action_type || action.type;
          const isWait = (aType === 'wait' || aType === 'delay');
          const delayMinutes = isWait
            ? (action.config?.minutes || action.minutes || action.delay_minutes || 5)
            : (action.delay_minutes || action.config?.delay_minutes || 0);
          const nextRunAt = new Date(Date.now() + delayMinutes * 60000);
          const nextStepToRun = isWait ? currentStep + 1 : currentStep;
          const execId = `wfexec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
             VALUES ($1, 'WorkflowExecution', $2, $3, NOW(), NOW())`,
            [execId, companyId, JSON.stringify({
              workflow_id: wfRow.id,
              workflow_name: wf.workflow_name || wf.name || 'Unnamed',
              trigger_type: triggerType,
              entity_type: sdkName,
              entity_id: entityId,
              entity_data: entityData,
              status: 'active',
              current_step: nextStepToRun,
              next_run_at: nextRunAt.toISOString(),
              started_at: new Date().toISOString(),
            })]
          );
        }
      } catch (wfErr) {
        console.warn(`[Workflows] Error processing workflow ${wfRow.id}:`, wfErr.message);
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

    // Early body-size check — must stay before auth so oversized-body probes get 413
    // without needing a session (mirrors vite-db-plugin.js behaviour).
    if ((req.method === 'PUT' || req.method === 'PATCH') && pathname.match(/^\/api\/local\/entity\/[^/]+\/.+/)) {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > 5 * 1024 * 1024) {
        return sendJson({ error: 'Request body too large (limit: 5 MB)' }, 413);
      }
    }

    // Centralized impersonation guard for all /api/local/* routes.
    // • Returns 401 when the impersonation window has expired.
    // • Returns 403 for every non-GET mutation while an impersonation session is active —
    //   covers the entity API AND every specialized route (auto-categorize, sync, admin
    //   helpers, etc.) before any of those handlers can run.
    //   The per-entity-route checks below remain as defense-in-depth.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      try {
        const impCtx = await tenantGuard.resolveRequestContext(req, getPool());
        if (impCtx.impersonationExpired) {
          return sendJson({ error: 'Impersonation session expired. Please return to the admin dashboard.' }, 401);
        }
        if (impCtx.isImpersonating) {
          console.warn(`[Security] IMPERSONATION WRITE BLOCKED (central): ${impCtx.email} attempted ${req.method} ${pathname} while impersonating ${impCtx.impersonatedCompanyId}`);
          return sendJson({ error: 'Forbidden: data writes are not permitted during an impersonation session' }, 403);
        }
      } catch (_) { /* don't break unauthenticated/public local routes */ }
    }

    const bulkDeletion = require('../lib/bulkDeletion.cjs');
    if (pathname === '/api/local/bulk-delete-permission' && req.method === 'GET') {
      const p = getPool();
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      const denied = bulkDeletion.contextError(ctx);
      if (denied) return sendJson({ error: denied.error }, denied.status);
      return sendJson({ allowed: await bulkDeletion.canBulkDelete(p, ctx, url.searchParams.get('company_id')) });
    }
    const bulkDeleteMatch = pathname.match(/^\/api\/local\/entity\/([^/]+)\/bulk-delete$/);
    if (bulkDeleteMatch && req.method === 'POST') {
      const p = getPool();
      const entityType = sdkNameToEntityType(bulkDeleteMatch[1]);
      if (isInternalEntityType(entityType)) return sendJson({ error: 'Not found' }, 404);
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      const denied = bulkDeletion.contextError(ctx);
      if (denied) return sendJson({ error: denied.error }, denied.status);
      const body = await parseBodyJson(req);
      const result = await bulkDeletion.deleteBatch({
        pool: p, ctx, entityType, ids: body?.ids, validateOnly: body?.validateOnly === true,
        table: isDedicatedTable(entityType) ? DEDICATED_TABLES[entityType].table : 'generic_entities',
        authorizeRecord: (context, type, record) => {
          const own = tenantGuard.checkOwnership(context, type, record, 'BULK DELETE');
          if (own.blocked) return 'Not authorized to delete these records.';
          const settings = require('../lib/insuranceClaimWelcome.cjs').settingsWriteGuard(context, type, null, record);
          return settings.blocked ? settings.reason : null;
        },
      });
      return sendJson(result, result.status);
    }

    // Exact unread badge count, plus the rows the dropdown is allowed to show.
    // Mirrors vite-db-plugin.js. Audience is the session user (or a company-wide
    // row), scoped with the same tenant rules as entity reads.
    if ((pathname === '/api/local/notifications/unread-count' || pathname === '/api/local/notifications') && req.method === 'GET') {
      const p = getPool();
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      const result = await notificationBell.handleBellRequest(p, ctx, {
        path: pathname,
        companyId: url.searchParams.get('company_id'),
        limit: url.searchParams.get('limit'),
      });
      return sendJson(result.body, result.status);
    }

    const entityCollectionMatch = pathname.match(/^\/api\/local\/entity\/([^/]+)$/);
    const entitySingleMatch = pathname.match(/^\/api\/local\/entity\/([^/]+)\/(.+)$/);

    if (entitySingleMatch) {
      const p = getPool();
      const sdkName = entitySingleMatch[1];
      const entityType = sdkNameToEntityType(sdkName);
      const recordId = entitySingleMatch[2];
      if (isInternalEntityType(entityType)) return sendJson({ error: 'Not found' }, 404);

      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated) return sendJson({ error: 'Unauthorized' }, 401);
      if (ctx.impersonationExpired) {
        return sendJson({ error: 'Impersonation session expired. Please return to the admin dashboard.' }, 401);
      }
      // Defense-in-depth: per-route write-block (centralized guard above fires first).
      if (ctx.isImpersonating && req.method !== 'GET') {
        console.warn(`[Security] IMPERSONATION WRITE BLOCKED: ${ctx.email} attempted ${req.method} on ${sdkName}/${recordId} while impersonating ${ctx.impersonatedCompanyId}`);
        return sendJson({ error: 'Forbidden: data writes are not permitted during an impersonation session' }, 403);
      }
      if (req.method === 'GET') {
        const record = await universalGet(p, entityType, recordId);
        if (!record) return sendJson({ error: 'Not found' }, 404);
        const own = tenantGuard.checkOwnership(ctx, entityType, record, `GET ${sdkName}`);
        if (own.blocked) return sendJson({ error: 'Not found' }, 404);
        return sendJson(record);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const existing = await universalGet(p, entityType, recordId);
        const welcomeSettingsGuard = require('../lib/insuranceClaimWelcome.cjs').settingsWriteGuard(ctx, entityType, null, existing);
        if (welcomeSettingsGuard.blocked) return sendJson({ error: welcomeSettingsGuard.reason }, 403);
        if (existing) {
          const own = tenantGuard.checkOwnership(ctx, entityType, existing, `PUT ${sdkName}`);
          if (own.blocked) return sendJson({ error: 'Not found' }, 404);
        }
        const rawBody = await parseBodyJson(req);
        let body = tenantGuard.stripCompanyIdFromUpdate(ctx, rawBody);
        body = tenantGuard.stripProtectedBillingFields(ctx, entityType, body, `PUT ${sdkName}`);
        body = tenantGuard.stripProtectedSubscriptionFields(ctx, entityType, body, false, `PUT ${sdkName}`);
        const adminSettingsCheck = tenantGuard.enforceAdminOnlyCompanySettings(ctx, entityType, body, existing, `PUT ${sdkName}`);
        if (adminSettingsCheck.blocked) return sendJson({ error: adminSettingsCheck.reason }, 403);
        const adminFieldsCheck = tenantGuard.enforceAdminOnlyCompanyFields(ctx, entityType, body, existing, `PUT ${sdkName}`);
        if (adminFieldsCheck.blocked) return sendJson({ error: adminFieldsCheck.reason }, 403);
        const changeOrderCheck = await tenantGuard.enforceChangeOrderApproval(ctx, entityType, body, existing, p, `PUT ${sdkName}`);
        if (changeOrderCheck.blocked) return sendJson({ error: changeOrderCheck.reason }, 403);
        body = changeOrderCheck.body;
        const invoiceCustomerUpdateCheck = invoiceCustomerLink.guardInvoiceCustomerUpdate(entityType, existing, body);
        if (invoiceCustomerUpdateCheck.blocked) return sendJson({ error: invoiceCustomerUpdateCheck.reason }, 403);
        const invoiceCustomerReferenceCheck = await invoiceCustomerLink.validateInvoiceCustomerReference(
          p, entityType, { ...existing, ...body }, `PUT ${sdkName}`
        );
        if (invoiceCustomerReferenceCheck.blocked) return sendJson({ error: invoiceCustomerReferenceCheck.reason }, 400);
        // Double-booking guard for CalendarEvent updates
        if (sdkName === 'CalendarEvent' && existing) {
          const mergedState = { ...existing, ...body };
          if (mergedState.start_time && mergedState.end_time) {
            const bookingConflict = await checkCalendarBookingConflict(p, mergedState, recordId);
            if (bookingConflict) {
              return sendJson({ error: bookingConflict.message, conflict: true, existing: bookingConflict.existing }, 409);
            }
          }
        }
        const updated = await universalUpdate(p, entityType, recordId, body);
        // Fire workflow triggers for status changes (invoice_paid, estimate_accepted, etc.)
        if (updated && updated.company_id) {
          fireWorkflowTriggersAsync(p, sdkName, 'update', recordId, updated, updated.company_id, existing)
            .catch(e => console.warn(`[DB] Workflow trigger error for ${sdkName} update:`, e.message));
          // CompanySync Bot chat alert on status transitions (non-blocking)
          chatBot.notifyEntityEvent(p, { sdkName, mutationType: 'update', before: existing, after: updated })
            .catch(e => console.warn(`[ChatBot] alert failed for ${sdkName} update:`, e.message));
        }
        return sendJson(updated);
      }
      if (req.method === 'DELETE') {
        const existing = await universalGet(p, entityType, recordId);
        const welcomeSettingsGuard = require('../lib/insuranceClaimWelcome.cjs').settingsWriteGuard(ctx, entityType, null, existing);
        if (welcomeSettingsGuard.blocked) return sendJson({ error: welcomeSettingsGuard.reason }, 403);
        if (existing) {
          const own = tenantGuard.checkOwnership(ctx, entityType, existing, `DELETE ${sdkName}`);
          if (own.blocked) return sendJson({ error: 'Not found' }, 404);
        }
        const deleted = await universalDelete(p, entityType, recordId);
        if (!deleted) return sendJson({ error: 'Not found' }, 404);
        return sendJson({ success: true, deleted: true });
      }
    }

    if (entityCollectionMatch) {
      const p = getPool();
      const sdkName = entityCollectionMatch[1];
      const entityType = sdkNameToEntityType(sdkName);
      if (isInternalEntityType(entityType)) return sendJson({ error: 'Not found' }, 404);

      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated) return sendJson({ error: 'Unauthorized' }, 401);
      if (ctx.impersonationExpired) {
        return sendJson({ error: 'Impersonation session expired. Please return to the admin dashboard.' }, 401);
      }
      // Defense-in-depth: per-route write-block (centralized guard above fires first).
      if (ctx.isImpersonating && req.method !== 'GET') {
        console.warn(`[Security] IMPERSONATION WRITE BLOCKED: ${ctx.email} attempted ${req.method} on ${sdkName} while impersonating ${ctx.impersonatedCompanyId}`);
        return sendJson({ error: 'Forbidden: data writes are not permitted during an impersonation session' }, 403);
      }
      if (req.method === 'GET') {
        const filters = {};
        for (const [k, v] of url.searchParams.entries()) {
          if (k === '_sort' || k === '_limit' || k === '_offset') continue;
          filters[k] = parseFilterValue(v);
        }
        const scopedFilters = tenantGuard.scopeListFilters(ctx, filters, entityType);
        const sort = url.searchParams.get('_sort') || '-created_date';
        const limit = parseInt(url.searchParams.get('_limit')) || 1000;
        const results = await universalFilter(p, entityType, scopedFilters, sort, limit);
        return sendJson(results);
      }
      if (req.method === 'POST') {
        const rawBody = await parseBodyJson(req);
        const welcomeSettingsGuard = require('../lib/insuranceClaimWelcome.cjs').settingsWriteGuard(ctx, entityType, rawBody);
        if (welcomeSettingsGuard.blocked) return sendJson({ error: welcomeSettingsGuard.reason }, 403);
        console.log(`[DB] POST ${sdkName} (${entityType}), isArray=${Array.isArray(rawBody)}`);
        if (Array.isArray(rawBody)) {
          const scopedBody = rawBody.map(item => tenantGuard.sanitizeChangeOrderOnCreate(ctx, entityType, tenantGuard.stripProtectedSubscriptionFields(ctx, entityType, tenantGuard.stripProtectedBillingFields(ctx, entityType, tenantGuard.enforceCompanyCreatedBy(ctx, entityType, tenantGuard.enforceCreateCompanyId(ctx, item, `POST ${sdkName} (bulk)`), `POST ${sdkName} (bulk)`), `POST ${sdkName} (bulk)`), true, `POST ${sdkName} (bulk)`), `POST ${sdkName} (bulk)`));
          const seenCalEvents = [];
          for (const item of scopedBody) {
            const claim = await tenantGuard.verifyNoCompanyCreateTarget(ctx, entityType, item, p, `POST ${sdkName} (bulk)`);
            if (claim.blocked) return sendJson({ error: claim.reason }, 403);
            const invoiceCustomerCheck = await invoiceCustomerLink.validateInvoiceCustomerReference(
              p, entityType, item, `POST ${sdkName} (bulk)`
            );
            if (invoiceCustomerCheck.blocked) return sendJson({ error: invoiceCustomerCheck.reason }, 400);
            // Double-booking guard: check against DB rows + earlier items in this batch
            if (sdkName === 'CalendarEvent') {
              const intraConflict = checkIntraPayloadCalendarConflict(seenCalEvents, item);
              if (intraConflict) return sendJson({ error: intraConflict.message, conflict: true, existing: intraConflict.existing }, 409);
              const bulkConflict = await checkCalendarBookingConflict(p, item, null);
              if (bulkConflict) return sendJson({ error: bulkConflict.message, conflict: true, existing: bulkConflict.existing }, 409);
              seenCalEvents.push(item);
            }
          }
          // ── Server-side entity count limit gate (bulk) ──────────────────
          // Enforce single-company payloads: enforceCreateCompanyId above
          // stamps the session company onto every item, but an explicit check
          // here guards against any future drift in that invariant.
          // LOCKSTEP: same check in vite-db-plugin.js; keep in sync.
          {
            const uniqueCompanyIds = [...new Set(scopedBody.map(item => item.company_id).filter(Boolean))];
            if (uniqueCompanyIds.length > 1) {
              return sendJson({ error: 'Bulk creates must all belong to the same company' }, 400);
            }
            const bulkCompanyId = uniqueCompanyIds[0] || null;
            const limitCheck = await checkEntityCreationLimit(p, entityType, bulkCompanyId, ctx.isSuperAdmin, scopedBody.length);
            if (!limitCheck.allowed) return sendJson({ error: limitCheck.error }, 403);
          }
          const results = await universalBulkCreate(p, entityType, scopedBody);
          return sendJson(results, 201);
        }
        let body = tenantGuard.enforceCreateCompanyId(ctx, rawBody, `POST ${sdkName}`);
        body = tenantGuard.enforceCompanyCreatedBy(ctx, entityType, body, `POST ${sdkName}`);
        body = tenantGuard.stripProtectedBillingFields(ctx, entityType, body, `POST ${sdkName}`);
        body = tenantGuard.stripProtectedSubscriptionFields(ctx, entityType, body, true, `POST ${sdkName}`);
        body = tenantGuard.sanitizeChangeOrderOnCreate(ctx, entityType, body, `POST ${sdkName}`);
        {
          const claim = await tenantGuard.verifyNoCompanyCreateTarget(ctx, entityType, body, p, `POST ${sdkName}`);
          if (claim.blocked) return sendJson({ error: claim.reason }, 403);
        }
        const invoiceCustomerCheck = await invoiceCustomerLink.validateInvoiceCustomerReference(
          p, entityType, body, `POST ${sdkName}`
        );
        if (invoiceCustomerCheck.blocked) return sendJson({ error: invoiceCustomerCheck.reason }, 400);
        // Double-booking guard for CalendarEvent creates
        if (sdkName === 'CalendarEvent') {
          const bookingConflict = await checkCalendarBookingConflict(p, body, null);
          if (bookingConflict) {
            return sendJson({ error: bookingConflict.message, conflict: true, existing: bookingConflict.existing }, 409);
          }
        }
        // ── Server-side entity count limit gate (staff / customer / lead) ──
        // LOCKSTEP: same check in vite-db-plugin.js; keep in sync.
        {
          const limitCheck = await checkEntityCreationLimit(p, entityType, body.company_id, ctx.isSuperAdmin);
          if (!limitCheck.allowed) return sendJson({ error: limitCheck.error }, 403);
        }
        const created = await universalCreate(p, entityType, body);
        if (sdkName === 'Payment' && created.company_id) {
          (async () => {
            const handlers = await require('./prod-integrations.cjs').getFunctionHandlers();
            return require('../lib/paymentStaffAlerts.cjs').notifyPaymentStaff(p, {
              companyId: created.company_id, paymentId: created.id,
              sendSms: opts => handlers.sendSMS(opts),
            });
          })().catch(e => console.warn('[Payment alert] Entity create failed:', e.message));
        }
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
          // CompanySync Bot chat alert (non-blocking)
          chatBot.notifyEntityEvent(p, { sdkName, mutationType: 'create', before: null, after: created })
            .catch(e => console.warn(`[ChatBot] alert failed for ${sdkName} create:`, e.message));
        }
        return sendJson(created, 201);
      }
    }

    if (pathname === '/api/local/invoices/link-customer' && req.method === 'POST') {
      const p = getPool();
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated) return sendJson({ error: 'Unauthorized' }, 401);
      if (ctx.impersonationExpired) {
        return sendJson({ error: 'Impersonation session expired. Please return to the admin dashboard.' }, 401);
      }
      const body = await parseBodyJson(req);
      const result = await invoiceCustomerLink.linkUnassignedInvoice({
        pool: p,
        ctx,
        invoiceId: body.invoice_id,
        customerId: body.customer_id,
        companyId: body.company_id,
        confirmed: body.confirmed,
      });
      return sendJson(result.body, result.status);
    }

    if (pathname === '/api/local/auto-provision' && req.method === 'POST') {
      const p = getPool();
      const sessionEmail = await tenantGuard.resolveSessionEmail(req, p);
      if (!sessionEmail) return sendJson({ error: 'Unauthorized' }, 401);
      const rl = rateLimit.checkRateLimit(`auto-provision:${rateLimit.getClientIp(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
      if (!rl.allowed) return sendJson({ error: 'Too many requests, please try again later.' }, 429);
      const body = await parseBodyJson(req);
      const { name } = body;
      const email = sessionEmail;

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
        `INSERT INTO companies
           (id, name, company_name, created_by, email, preferred_language,
            subscription_plan, subscription_status, is_deleted, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'en', 'professional', 'pending', false,
                 $6::jsonb, NOW(), NOW())`,
        [
          companyId,
          companyName,
          companyName,
          email,
          email,
          JSON.stringify({ signup_source: 'google_oauth', setup_completed: false, onboarding_completed: false }),
        ]
      );

      const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await p.query(
        `INSERT INTO staff_profiles (id, company_id, name, full_name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, true, true, NOW(), NOW())`,
        [staffId, companyId, displayName, displayName, email, email]
      );

      // Auto-provision is a signup path, not a subscription grant. Route it
      // through startCompanyTrial so the durable signup event, Day-0 nurture,
      // platform-admin email/SMS, limits, and trial dates are all created.
      const invokeResponse = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/functions/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.cookie || '',
        },
        body: JSON.stringify({
          functionName: 'startCompanyTrial',
          params: { companyId, plan: 'professional' },
        }),
      });
      const invokeEnvelope = await invokeResponse.json().catch(() => ({}));
      const trialResult = invokeEnvelope?.data || invokeEnvelope;
      if (!invokeResponse.ok || trialResult?.success !== true) {
        await p.query('DELETE FROM staff_profiles WHERE company_id = $1 AND LOWER(user_email) = $2', [companyId, email]);
        await p.query(
          `DELETE FROM companies
           WHERE id = $1 AND LOWER(created_by) = $2 AND subscription_status = 'pending'`,
          [companyId, email]
        );
        return sendJson({ error: trialResult?.error || 'Unable to start the free trial' }, 500);
      }

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
      const { ensureSuperAdmin } = require('../lib/superAdminSeed.cjs');
      const result = await ensureSuperAdmin(p);
      if (!result.seeded && result.reason === 'missing-env') {
        return sendJson({ success: false, error: 'Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (12+ characters) before seeding a super-admin.' }, 400);
      }
      return sendJson({ success: true, seeded: !!result.seeded, reason: result.reason });
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

    if (pathname === '/api/local/email-provider-status' && req.method === 'GET') {
      const { getEmailProviderStatusPublic } = require('../lib/emailProviderHealth.cjs');
      const status = await getEmailProviderStatusPublic();
      return sendJson({ success: true, ...status });
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
        aerial_view: {
          connected: !!data.aerial_view_api_key,
          masked_key: data.aerial_view_api_key ? maskApiKey(decryptApiKey(data.aerial_view_api_key)) : '',
        },
        lead_data: {
          batchleads_connected: !!data.batchleads_api_key,
          masked_batchleads_key: data.batchleads_api_key ? maskApiKey(decryptApiKey(data.batchleads_api_key)) : '',
          propstream_connected: !!data.propstream_api_key,
          masked_propstream_key: data.propstream_api_key ? maskApiKey(decryptApiKey(data.propstream_api_key)) : '',
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
      } else if (service === 'aerial_view') {
        if (keys.api_key) updatedData.aerial_view_api_key = encryptApiKey(keys.api_key);
        else if (keys.remove) updatedData.aerial_view_api_key = null;
      } else if (service === 'lead_data') {
        if (keys.batchleads_api_key) updatedData.batchleads_api_key = encryptApiKey(keys.batchleads_api_key);
        else if (keys.remove_batchleads) updatedData.batchleads_api_key = null;
        if (keys.propstream_api_key) updatedData.propstream_api_key = encryptApiKey(keys.propstream_api_key);
        else if (keys.remove_propstream) updatedData.propstream_api_key = null;
      } else {
        return sendJson({ error: 'Invalid service. Must be gemini, twilio, email, aerial_view, or lead_data' }, 400);
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
          const resp = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: 'Say "hello" in one word.' }] }],
                generationConfig: { maxOutputTokens: 10 },
              }),
            },
            { timeoutMs: 15000 }
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
    // CHILD COMPANY OWNER SETUP (privileged path — bypasses tenant guard for owner StaffProfile)
    // POST /api/local/setup-child-company-owner
    // ==========================================
    if (pathname === '/api/local/setup-child-company-owner' && req.method === 'POST') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated) return sendJson({ error: 'Authentication required' }, 401);
      const body = await parseBodyJson(req);
      const { company_id } = body;
      if (!company_id) return sendJson({ error: 'company_id required' }, 400);
      // Verify caller is the creator of the target company
      const compRow = await p.query(
        `SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1`,
        [company_id]
      );
      if (!compRow.rows.length) return sendJson({ error: 'Company not found' }, 404);
      const storedCreatedBy = (compRow.rows[0].created_by || '').toLowerCase();
      if (storedCreatedBy !== (ctx.email || '').toLowerCase()) {
        console.warn(`[Security] setup-child-company-owner: ${ctx.email} is not created_by of ${company_id}`);
        return sendJson({ error: 'Forbidden: you are not the creator of this company' }, 403);
      }
      // Check if owner StaffProfile already exists (check both user_email and email columns)
      const existing = await p.query(
        `SELECT id FROM staff_profiles WHERE company_id = $1 AND (LOWER(user_email) = $2 OR LOWER(email) = $2) LIMIT 1`,
        [company_id, ctx.email]
      );
      if (existing.rows.length > 0) {
        return sendJson({ success: true, message: 'Owner StaffProfile already exists', profile_id: existing.rows[0].id });
      }
      // Create owner StaffProfile in staff_profiles
      // LOCKSTEP: keep in sync with the equivalent block in vite-db-plugin.js.
      const { randomUUID } = require('crypto');
      const profileId = randomUUID();
      await p.query(
        `INSERT INTO staff_profiles (id, company_id, user_email, is_administrator, is_active, role_id, created_at, updated_at)
         VALUES ($1, $2, $3, true, true, 'admin', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [profileId, company_id, ctx.email]
      );
      console.log(`[Setup] Created owner StaffProfile ${profileId} for ${ctx.email} in child company ${company_id}`);
      return sendJson({ success: true, profile_id: profileId });
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
        // These direct routes resolve no tenant context, so there is nobody to
        // authorize or attribute a change-order approval to. Refuse the
        // decision outright rather than let it around the entity-API guard.
        if (entityType === 'estimates') {
          const coCheck = tenantGuard.rejectChangeOrderDecision(
            entityType, body, await universalGet(p, entityType, id), `PUT /api/local/${entityType}/:id`,
          );
          if (coCheck.blocked) return sendJson({ success: false, error: coCheck.reason }, 403);
        }
        // Double-booking guard for direct calendar_events PUT/PATCH
        if (entityType === 'calendar_events') {
          const existing = await universalGet(p, entityType, id);
          const merged = { ...existing, ...body };
          const conflict = await checkCalendarBookingConflict(p, merged, id);
          if (conflict) return sendJson({ success: false, error: conflict.message, conflict: true, existing: conflict.existing }, 409);
        }
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
          filters[k] = parseFilterValue(v);
        }
        const sort = url.searchParams.get('_sort') || '-created_at';
        const limit = parseInt(url.searchParams.get('_limit')) || 1000;
        const results = await universalFilter(p, entityType, filters, sort, limit);
        return sendJson({ success: true, [entityType]: results });
      }
      if (req.method === 'POST') {
        let body = await parseBodyJson(req);
        console.log(`[DB] POST ${entityType} (direct route)`);
        // No tenant context here, so no caller can be authorized — force any
        // change order created through this route to the undecided state.
        if (entityType === 'estimates') {
          const label = `POST /api/local/${entityType}`;
          body = Array.isArray(body)
            ? body.map((item) => tenantGuard.sanitizeChangeOrderOnCreate(null, entityType, item, label))
            : tenantGuard.sanitizeChangeOrderOnCreate(null, entityType, body, label);
        }
        if (Array.isArray(body)) {
          // Double-booking guard for direct bulk calendar_events POSTs (DB + intra-payload)
          if (entityType === 'calendar_events') {
            const seenCalEvents = [];
            for (const item of body) {
              const intraConflict = checkIntraPayloadCalendarConflict(seenCalEvents, item);
              if (intraConflict) return sendJson({ success: false, error: intraConflict.message, conflict: true, existing: intraConflict.existing }, 409);
              const conflict = await checkCalendarBookingConflict(p, item, null);
              if (conflict) return sendJson({ success: false, error: conflict.message, conflict: true, existing: conflict.existing }, 409);
              seenCalEvents.push(item);
            }
          }
          // ── Server-side entity count limit gate (bulk, direct route) ────────
          // Reject mixed-company bulk payloads — every item must share the same
          // company_id so the count check applies to exactly one tenant.
          // LOCKSTEP: same check in vite-db-plugin.js; keep in sync.
          {
            const uniqueCompanyIds = [...new Set(body.map(item => item.company_id).filter(Boolean))];
            if (uniqueCompanyIds.length > 1) {
              return sendJson({ error: 'Bulk creates must all belong to the same company' }, 400);
            }
            const bulkCompanyId = uniqueCompanyIds[0] || null;
            const limitCheck = await checkEntityCreationLimit(p, entityType, bulkCompanyId, false, body.length);
            if (!limitCheck.allowed) return sendJson({ error: limitCheck.error }, 403);
          }
          const results = await universalBulkCreate(p, entityType, body);
          return sendJson({ success: true, [entityType]: results }, 201);
        }
        // Double-booking guard for direct single calendar_events POST
        if (entityType === 'calendar_events') {
          const conflict = await checkCalendarBookingConflict(p, body, null);
          if (conflict) return sendJson({ success: false, error: conflict.message, conflict: true, existing: conflict.existing }, 409);
        }
        // ── Server-side entity count limit gate (single, direct route) ───────
        // LOCKSTEP: same check in vite-db-plugin.js; keep in sync.
        {
          const limitCheck = await checkEntityCreationLimit(p, entityType, body.company_id, false);
          if (!limitCheck.allowed) return sendJson({ error: limitCheck.error }, 403);
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

    // ==========================================
    // REP PERFORMANCE TEAM SUMMARY
    // GET /api/local/rep-performance-summary?company_id=X&period=current_month
    // ==========================================
    if (pathname === '/api/local/rep-performance-summary' && req.method === 'GET') {
      const p = getPool();
      const companyId = url.searchParams.get('company_id');
      if (!companyId) return sendJson({ error: 'company_id required' }, 400);

      const period = url.searchParams.get('period') || 'all_time';
      const now = new Date();
      let startDate = new Date(0), endDate = new Date();
      if (period === 'current_month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (period === 'last_month') {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      } else if (period === 'current_quarter') {
        const q = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), q * 3, 1);
        endDate = new Date(now.getFullYear(), (q + 1) * 3, 0, 23, 59, 59, 999);
      } else if (period === 'ytd') {
        startDate = new Date(now.getFullYear(), 0, 1); endDate = now;
      }
      const startDateParam = url.searchParams.get('start_date');
      const endDateParam = url.searchParams.get('end_date');
      if (startDateParam) startDate = new Date(startDateParam);
      if (endDateParam) endDate = new Date(endDateParam);
      const isAllTimePeriod = period === 'all_time';
      // Full ISO for created_at / payment_date (TIMESTAMP columns, exact comparison safe).
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();
      // Date-only for issue_date (TEXT column storing YYYY-MM-DD or YYYY-MM-DDTHH…).
      // Using SUBSTRING(issue_date,1,10) in SQL normalises both formats.
      const startDateOnly = startDate.toISOString().slice(0, 10);
      const endDateOnly = endDate.toISOString().slice(0, 10);

      const staffRes = await p.query(
        `SELECT user_email, full_name, avatar_url, commission_rate FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL ORDER BY full_name`,
        [companyId]
      );
      if (!staffRes.rows.length) return sendJson({ success: true, rows: [] });

      const [leadsRes, custRes, commRes, periodInvRes, allInvRes, payRes] = await Promise.all([
        isAllTimePeriod
          ? p.query(`SELECT id, assigned_to, assigned_to_users, status FROM leads WHERE company_id = $1`, [companyId])
          : p.query(`SELECT id, assigned_to, assigned_to_users, status FROM leads WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`, [companyId, startIso, endIso]),
        isAllTimePeriod
          ? p.query(`SELECT id, assigned_to, assigned_to_users FROM customers WHERE company_id = $1`, [companyId])
          : p.query(`SELECT id, assigned_to, assigned_to_users FROM customers WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`, [companyId, startIso, endIso]),
        isAllTimePeriod
          ? p.query(`SELECT id, data->>'assigned_to' AS assigned_to, created_by, lead_id, customer_id FROM communications WHERE company_id = $1`, [companyId])
          : p.query(`SELECT id, data->>'assigned_to' AS assigned_to, created_by, lead_id, customer_id FROM communications WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`, [companyId, startIso, endIso]),
        isAllTimePeriod
          ? p.query(`SELECT id, total_amount, amount, sale_agent, created_by, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`, [companyId])
          : p.query(`SELECT id, total_amount, amount, sale_agent, created_by, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid' AND SUBSTRING(issue_date, 1, 10) >= $2 AND SUBSTRING(issue_date, 1, 10) <= $3`, [companyId, startDateOnly, endDateOnly]),
        p.query(`SELECT id, sale_agent, created_by, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`, [companyId]),
        isAllTimePeriod
          ? p.query(`SELECT amount, invoice_id FROM payments WHERE company_id = $1`, [companyId])
          : p.query(`SELECT amount, invoice_id FROM payments WHERE company_id = $1 AND payment_date >= $2 AND payment_date <= $3`, [companyId, startIso, endIso]),
      ]);

      const payByInvId = {};
      for (const pay of payRes.rows) {
        if (pay.invoice_id) payByInvId[pay.invoice_id] = (payByInvId[pay.invoice_id] || 0) + parseFloat(pay.amount || 0);
      }
      const WON_SET = new Set(['closed', 'won']);

      const rows = staffRes.rows.map(rep => {
        const email = rep.user_email;
        const emailLc = email.toLowerCase();
        const nameLc = (rep.full_name || '').trim().toLowerCase();
        const matchRep = (val) => { if (!val) return false; const v = String(val).trim().toLowerCase(); return v === emailLc || (nameLc && v === nameLc); };
        const matchArr = (arr) => Array.isArray(arr) && arr.some(u => matchRep(u));

        const repLeads = leadsRes.rows.filter(l => matchRep(l.assigned_to) || matchArr(l.assigned_to_users));
        const repLeadIds = new Set(repLeads.map(l => l.id));
        const repCustomers = custRes.rows.filter(c => matchRep(c.assigned_to) || matchArr(c.assigned_to_users));
        const repCustIds = new Set(repCustomers.map(c => c.id));
        const repComms = commRes.rows.filter(c => matchRep(c.assigned_to) || matchRep(c.created_by) || repLeadIds.has(c.lead_id) || repCustIds.has(c.customer_id));

        let commission = 0;
        for (const inv of periodInvRes.rows) {
          const invTotal = parseFloat(inv.total_amount || inv.amount || 0);
          const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
          const split = splits.find(s => s && s.user_email === email);
          if (split) {
            commission += invTotal * (Number(split.split_percentage || 0) / 100) * ((rep.commission_rate || 5) / 100);
          } else if (!splits.length && (inv.sale_agent === email || inv.created_by === email)) {
            commission += invTotal * ((rep.commission_rate || 5) / 100);
          }
        }

        const repInvIds = new Set(allInvRes.rows.filter(inv => {
          const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
          return splits.length ? splits.some(s => s && s.user_email === email) : (inv.sale_agent === email || inv.created_by === email);
        }).map(inv => inv.id));
        let collected = 0;
        for (const [invId, amt] of Object.entries(payByInvId)) {
          if (repInvIds.has(invId)) collected += amt;
        }

        return { user_email: email, full_name: rep.full_name, avatar_url: rep.avatar_url, commission_rate: rep.commission_rate, leads: repLeads.length, won: repLeads.filter(l => WON_SET.has((l.status || '').toLowerCase())).length, customers: repCustomers.length, interactions: repComms.length, commission, collected };
      });
      return sendJson({ success: true, rows });
    }

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

async function sendImpersonationEmail({ to, subject, html }) {
  if (require('../lib/emailTransport.cjs').activeProvider() === 'none') { console.warn('[Email] No email provider configured — skipping impersonation notification'); return; }
  try {
    await require('../lib/emailTransport.cjs').sendPlatformEmail({ to, from: 'CompanySync <noreply@companysync.io>', subject, html });
  } catch (e) {
    console.warn('[Impersonation] Email send error:', e.message);
  }
}

async function handleImpersonationRoute(req, res, pathname, url) {
  const sendJson = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };
  const p = getPool();
  try {
    if (pathname === '/api/impersonation/start' && req.method === 'POST') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated || !ctx.isSuperAdmin) return sendJson({ error: 'Super-admin access required' }, 403);
      const body = await parseBodyJson(req);
      const { target_company_id, target_company_name, reason } = body;
      if (!target_company_id || !reason?.trim()) return sendJson({ error: 'target_company_id and reason are required' }, 400);
      const { randomUUID } = require('crypto');
      const logId = randomUUID();
      // Fixed 30-minute policy — non-overridable by client regardless of body params
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      // Atomic double-start prevention: acquire a transaction-scoped advisory lock keyed by
      // the admin's email before the existence check so two simultaneous /start requests can't
      // both pass the SELECT and both INSERT active sessions (race condition).
      let existingCompanyName = null;
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        // Lock released automatically on COMMIT/ROLLBACK.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ctx.email]);
        const existingSession = await client.query(
          `SELECT id, target_company_name FROM impersonation_logs WHERE admin_email = $1 AND is_active = true AND expires_at > NOW() LIMIT 1`,
          [ctx.email]
        );
        if (existingSession.rows.length > 0) {
          existingCompanyName = existingSession.rows[0].target_company_name;
          await client.query('ROLLBACK');
        } else {
          await client.query(
            `INSERT INTO impersonation_logs (id, admin_email, target_company_id, target_company_name, reason, is_active, expires_at) VALUES ($1, $2, $3, $4, $5, true, $6)`,
            [logId, ctx.email, target_company_id, target_company_name || 'Unknown', reason.trim(), expiresAt]
          );
          if (ctx._sid) {
            await client.query(
              `UPDATE sessions SET sess = sess || $1::jsonb WHERE sid = $2`,
              [JSON.stringify({ impersonating_company_id: target_company_id, impersonation_expires_at: expiresAt.toISOString(), impersonation_log_id: logId }), ctx._sid]
            );
          }
          await client.query('COMMIT');
        }
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      if (existingCompanyName !== null) {
        return sendJson({ error: `You already have an active session for "${existingCompanyName}". Stop it before starting a new one.` }, 409);
      }
      try {
        const compRow = await p.query('SELECT email, created_by FROM companies WHERE id = $1 LIMIT 1', [target_company_id]);
        const ownerEmail = compRow.rows[0]?.email || compRow.rows[0]?.created_by;
        if (ownerEmail && ownerEmail.includes('@')) {
          sendImpersonationEmail({
            to: ownerEmail,
            subject: '🔔 CompanySync Support Session Started',
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#dc2626">Account Access Notification</h2><p>A CompanySync support agent started a support session for your account. They can view and make changes on your behalf to help resolve your issue or complete onboarding.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><td style="padding:8px;background:#f9fafb;font-weight:600">Reason</td><td style="padding:8px">${reason.trim()}</td></tr><tr><td style="padding:8px;background:#f9fafb;font-weight:600">Started</td><td style="padding:8px">${new Date().toUTCString()}</td></tr><tr><td style="padding:8px;background:#f9fafb;font-weight:600">Expires</td><td style="padding:8px">${expiresAt.toUTCString()}</td></tr></table><p style="color:#6b7280;font-size:13px">All support sessions are logged and you can review them in your Security & Compliance settings. Questions? Contact io.companysync@gmail.com.</p></div>`,
          }).catch(() => {});
        }
      } catch (_) {}
      console.log(`[Security] IMPERSONATION START: ${ctx.email} → ${target_company_id} reason: ${reason.trim()}`);
      return sendJson({ success: true, log_id: logId, expires_at: expiresAt.toISOString() });
    }

    if (pathname === '/api/impersonation/stop' && req.method === 'POST') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated || !ctx.isSuperAdmin) return sendJson({ error: 'Super-admin access required' }, 403);
      const logId = ctx._impersonationLogId;
      if (logId) {
        await p.query(
          `UPDATE impersonation_logs SET ended_at = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60), is_active = false WHERE id = $1`,
          [logId]
        );
      }
      if (ctx._sid) {
        await p.query(
          `UPDATE sessions SET sess = sess - 'impersonating_company_id' - 'impersonation_expires_at' - 'impersonation_log_id' WHERE sid = $1`,
          [ctx._sid]
        );
      }
      console.log(`[Security] IMPERSONATION STOP: ${ctx.email} (log: ${logId})`);
      return sendJson({ success: true });
    }

    // The browser tab is not the source of truth for impersonation: the session
    // cookie is. A reload or a second tab has no sessionStorage, so without this
    // the shell and the data layer disagree about which tenant is active while
    // the server still scopes/blocks by session.
    if (pathname === '/api/impersonation/status' && req.method === 'GET') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated) return sendJson({ error: 'Unauthorized' }, 401);
      if (!ctx.isImpersonating || !ctx.impersonatedCompanyId) {
        return sendJson({ active: false, company_id: null, company_name: null, expires_at: null });
      }
      let companyName = null;
      let expiresAt = null;
      try {
        if (ctx._impersonationLogId) {
          const logRow = await p.query(
            'SELECT target_company_name, expires_at FROM impersonation_logs WHERE id = $1',
            [ctx._impersonationLogId]
          );
          companyName = logRow.rows[0]?.target_company_name || null;
          expiresAt = logRow.rows[0]?.expires_at || null;
        }
        if (!companyName) {
          const companyRow = await p.query('SELECT company_name FROM companies WHERE id = $1', [ctx.impersonatedCompanyId]);
          companyName = companyRow.rows[0]?.company_name || null;
        }
      } catch (e) {
        console.warn('[Impersonation] Status lookup failed:', e.message);
      }
      return sendJson({
        active: true,
        company_id: ctx.impersonatedCompanyId,
        company_name: companyName,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
    }

    if (pathname === '/api/impersonation/view-as' && req.method === 'POST') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated || !ctx.isSuperAdmin) return sendJson({ error: 'Super-admin access required' }, 403);
      const body = await parseBodyJson(req);
      const { user_email } = body;
      const logId = ctx._impersonationLogId;
      if (logId && user_email) {
        await p.query(
          `UPDATE impersonation_logs SET view_as_user_email = $1 WHERE id = $2 AND is_active = true`,
          [user_email, logId]
        ).catch(e => console.warn('[Impersonation] view-as update error:', e.message));
      }
      return sendJson({ success: true });
    }

    if (pathname === '/api/impersonation/log-view' && req.method === 'POST') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated || !ctx.isSuperAdmin) return sendJson({ error: 'Super-admin access required' }, 403);
      const body = await parseBodyJson(req);
      const { target_company_id, target_company_name } = body;
      if (!target_company_id) return sendJson({ error: 'target_company_id is required' }, 400);
      const { randomUUID } = require('crypto');
      const logId = randomUUID();
      await p.query(
        `INSERT INTO impersonation_logs (id, admin_email, target_company_id, target_company_name, reason, is_active, expires_at, action_type)
         VALUES ($1, $2, $3, $4, 'Dashboard view', false, NOW(), 'view')`,
        [logId, ctx.email, target_company_id, target_company_name || 'Unknown']
      );
      console.log(`[Security] COMPANY VIEW: ${ctx.email} → ${target_company_id}`);
      return sendJson({ success: true, log_id: logId });
    }

    if (pathname === '/api/impersonation/logs' && req.method === 'GET') {
      const ctx = await tenantGuard.resolveRequestContext(req, p);
      if (!ctx.authenticated) return sendJson({ error: 'Unauthorized' }, 401);
      const type = url.searchParams.get('type') || 'company';
      if (type === 'all') {
        if (!ctx.isSuperAdmin) return sendJson({ error: 'Super-admin access required' }, 403);
        const rows = await p.query('SELECT * FROM impersonation_logs ORDER BY started_at DESC LIMIT 200');
        return sendJson(rows.rows);
      }
      const companyId = url.searchParams.get('company_id');
      const ids = Array.from(ctx.allowedCompanyIds);
      const targetId = companyId || (ids.length > 0 ? ids[0] : null);
      if (!targetId) return sendJson([]);
      if (!ctx.isSuperAdmin && !ctx.allowedCompanyIds.has(targetId)) return sendJson({ error: 'Access denied' }, 403);
      const rows = await p.query('SELECT * FROM impersonation_logs WHERE target_company_id = $1 ORDER BY started_at DESC LIMIT 100', [targetId]);
      return sendJson(rows.rows);
    }

    sendJson({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('[Impersonation] Handler error:', e.message);
    sendJson({ error: 'Internal server error' }, 500);
  }
}

module.exports = { initDatabase, getPool, handleLocalDbRoute, handleImpersonationRoute, getCallRouting, syncEntityBatch, getDashboardData, encryptApiKey, decryptApiKey, maskApiKey, detectSmtpSettings, getCompanyGeminiKey, getCompanyTwilioConfig, getCompanyEmailConfig, getCompanyPlan, getDailyAIUsage, incrementDailyAIUsage };
