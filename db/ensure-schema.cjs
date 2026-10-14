'use strict';
/**
 * Additive schema for a fresh Postgres and for the existing production database.
 * Creates missing tables and missing columns only. Does not drop, rename, retype,
 * or rewrite existing rows.
 *
 * Column lists are the union of db/schema.js and db/prod-db.cjs, plus columns
 * referenced by INSERT/UPDATE statements in the app (calendar tokens, Stripe
 * account fields, invite flags, and similar).
 */

const TABLES = [
  {
    "name": "calendar_events",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "title",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'scheduled'"
      },
      {
        "name": "google_event_id",
        "def": "TEXT"
      },
      {
        "name": "outlook_event_id",
        "def": "TEXT"
      },
      {
        "name": "event_type",
        "def": "TEXT"
      },
      {
        "name": "start_time",
        "def": "TIMESTAMP"
      },
      {
        "name": "end_time",
        "def": "TIMESTAMP"
      },
      {
        "name": "location",
        "def": "TEXT"
      },
      {
        "name": "attendees",
        "def": "TEXT"
      },
      {
        "name": "assigned_to",
        "def": "TEXT"
      },
      {
        "name": "description",
        "def": "TEXT"
      },
      {
        "name": "color",
        "def": "TEXT"
      },
      {
        "name": "related_customer",
        "def": "TEXT"
      },
      {
        "name": "related_lead",
        "def": "TEXT"
      },
      {
        "name": "is_saas_event",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "send_email_notification",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "send_sms_notification",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "send_browser_notification",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "email_reminder_minutes",
        "def": "INTEGER"
      },
      {
        "name": "sms_reminder_minutes",
        "def": "INTEGER"
      },
      {
        "name": "browser_reminder_minutes",
        "def": "INTEGER"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "call_routing_cache",
    "pk": [
      "phone_number"
    ],
    "columns": [
      {
        "name": "phone_number",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "company_name",
        "def": "TEXT"
      },
      {
        "name": "assistant_name",
        "def": "TEXT DEFAULT 'Alex'"
      },
      {
        "name": "routing_mode",
        "def": "TEXT DEFAULT 'sarah_answers'"
      },
      {
        "name": "cell_phone",
        "def": "TEXT"
      },
      {
        "name": "rep_name",
        "def": "TEXT"
      },
      {
        "name": "rep_email",
        "def": "TEXT"
      },
      {
        "name": "twilio_sid",
        "def": "TEXT"
      },
      {
        "name": "twilio_token",
        "def": "TEXT"
      },
      {
        "name": "twilio_phone",
        "def": "TEXT"
      },
      {
        "name": "availability_status",
        "def": "TEXT DEFAULT 'available'"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "chat_conversations",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "chat_type",
        "def": "TEXT DEFAULT 'direct'"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "participants",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "last_message",
        "def": "TEXT"
      },
      {
        "name": "last_message_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "avatar_url",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "chat_messages",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "conversation_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "sender_email",
        "def": "TEXT"
      },
      {
        "name": "sender_name",
        "def": "TEXT"
      },
      {
        "name": "message",
        "def": "TEXT"
      },
      {
        "name": "message_type",
        "def": "TEXT DEFAULT 'text'"
      },
      {
        "name": "task_id",
        "def": "TEXT"
      },
      {
        "name": "task_title",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "attachment_name",
        "def": "TEXT"
      },
      {
        "name": "reactions",
        "def": "JSONB DEFAULT '{}'::jsonb"
      }
    ]
  },
  {
    "name": "chat_read_receipts",
    "pk": [
      "user_email",
      "conversation_id"
    ],
    "columns": [
      {
        "name": "user_email",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "conversation_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "last_read_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "communications",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "type",
        "def": "TEXT"
      },
      {
        "name": "communication_type",
        "def": "TEXT"
      },
      {
        "name": "direction",
        "def": "TEXT"
      },
      {
        "name": "contact_name",
        "def": "TEXT"
      },
      {
        "name": "contact_phone",
        "def": "TEXT"
      },
      {
        "name": "contact_email",
        "def": "TEXT"
      },
      {
        "name": "subject",
        "def": "TEXT"
      },
      {
        "name": "body",
        "def": "TEXT"
      },
      {
        "name": "message",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT"
      },
      {
        "name": "ai_summary",
        "def": "TEXT"
      },
      {
        "name": "sentiment",
        "def": "TEXT"
      },
      {
        "name": "intent",
        "def": "TEXT"
      },
      {
        "name": "duration_minutes",
        "def": "INTEGER"
      },
      {
        "name": "is_read",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "lead_id",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "companies",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "company_name",
        "def": "TEXT"
      },
      {
        "name": "company_tagline",
        "def": "TEXT"
      },
      {
        "name": "company_logo",
        "def": "TEXT"
      },
      {
        "name": "logo_url",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "is_deleted",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "phone",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT"
      },
      {
        "name": "address",
        "def": "TEXT"
      },
      {
        "name": "website",
        "def": "TEXT"
      },
      {
        "name": "industry",
        "def": "TEXT DEFAULT 'roofing'"
      },
      {
        "name": "timezone",
        "def": "TEXT"
      },
      {
        "name": "preferred_language",
        "def": "TEXT DEFAULT 'en'"
      },
      {
        "name": "subscription_plan",
        "def": "TEXT"
      },
      {
        "name": "subscription_status",
        "def": "VARCHAR(50) DEFAULT 'active'"
      },
      {
        "name": "parent_company_id",
        "def": "VARCHAR(255) DEFAULT NULL"
      },
      {
        "name": "stripe_customer_id",
        "def": "TEXT"
      },
      {
        "name": "stripe_subscription_id",
        "def": "TEXT"
      },
      {
        "name": "trial_end_date",
        "def": "TIMESTAMP"
      },
      {
        "name": "max_users",
        "def": "INTEGER DEFAULT 5"
      },
      {
        "name": "max_leads",
        "def": "INTEGER DEFAULT 100"
      },
      {
        "name": "ai_credits_purchased",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "sms_credits_purchased",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "call_credits_purchased",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "onboarding_completed",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "features_enabled",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "branding",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "settings",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "stripe_subscription_amount",
        "def": "NUMERIC DEFAULT 0"
      },
      {
        "name": "stripe_subscription_status",
        "def": "TEXT"
      },
      {
        "name": "stripe_account_id",
        "def": "TEXT"
      },
      {
        "name": "stripe_onboarding_status",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "credit_grants",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "session_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "purchase_type",
        "def": "TEXT"
      },
      {
        "name": "granted",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "customers",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "customer_number",
        "def": "SERIAL"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "company_name",
        "def": "TEXT"
      },
      {
        "name": "customer_type",
        "def": "TEXT DEFAULT 'residential'"
      },
      {
        "name": "email",
        "def": "TEXT"
      },
      {
        "name": "phone",
        "def": "TEXT"
      },
      {
        "name": "phone_2",
        "def": "TEXT"
      },
      {
        "name": "street",
        "def": "TEXT"
      },
      {
        "name": "city",
        "def": "TEXT"
      },
      {
        "name": "state",
        "def": "TEXT"
      },
      {
        "name": "zip",
        "def": "TEXT"
      },
      {
        "name": "address",
        "def": "TEXT"
      },
      {
        "name": "website",
        "def": "TEXT"
      },
      {
        "name": "source",
        "def": "TEXT DEFAULT 'other'"
      },
      {
        "name": "referral_source",
        "def": "TEXT"
      },
      {
        "name": "custom_source",
        "def": "TEXT"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "group_name",
        "def": "TEXT"
      },
      {
        "name": "assigned_to",
        "def": "TEXT"
      },
      {
        "name": "assigned_to_users",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "tags",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "insurance_company",
        "def": "TEXT"
      },
      {
        "name": "claim_number",
        "def": "TEXT"
      },
      {
        "name": "adjuster_name",
        "def": "TEXT"
      },
      {
        "name": "adjuster_phone",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'active'"
      },
      {
        "name": "total_revenue",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "portal_token",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "quickbooks_customer_id",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "email_delivery_events",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "provider",
        "def": "TEXT"
      },
      {
        "name": "message_id",
        "def": "TEXT"
      },
      {
        "name": "event",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "detail",
        "def": "TEXT"
      },
      {
        "name": "occurred_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "applied_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "matched",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "attempts",
        "def": "INTEGER NOT NULL DEFAULT 0"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMPTZ DEFAULT NOW()"
      },
      {
        "name": "last_attempted_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "correlation_id",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "email_pending_associations",
    "pk": [
      "communication_id"
    ],
    "columns": [
      {
        "name": "communication_id",
        "def": "TEXT"
      },
      {
        "name": "provider",
        "def": "TEXT"
      },
      {
        "name": "message_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "delivery_status",
        "def": "TEXT"
      },
      {
        "name": "attempts",
        "def": "INTEGER NOT NULL DEFAULT 0"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMPTZ DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "estimates",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "customer_name",
        "def": "TEXT"
      },
      {
        "name": "customer_email",
        "def": "TEXT"
      },
      {
        "name": "customer_phone",
        "def": "TEXT"
      },
      {
        "name": "estimate_number",
        "def": "TEXT"
      },
      {
        "name": "title",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'draft'"
      },
      {
        "name": "total_amount",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "property_address",
        "def": "TEXT"
      },
      {
        "name": "lead_id",
        "def": "TEXT"
      },
      {
        "name": "insurance_company",
        "def": "TEXT"
      },
      {
        "name": "claim_number",
        "def": "TEXT"
      },
      {
        "name": "adjuster_name",
        "def": "TEXT"
      },
      {
        "name": "adjuster_phone",
        "def": "TEXT"
      },
      {
        "name": "adjustment_amount",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "discount_type",
        "def": "TEXT"
      },
      {
        "name": "discount_value",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "items",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "tags",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "valid_until",
        "def": "TEXT"
      },
      {
        "name": "reference_number",
        "def": "TEXT"
      },
      {
        "name": "format_id",
        "def": "TEXT"
      },
      {
        "name": "category",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "amount",
        "def": "NUMERIC(12,2)"
      }
    ]
  },
  {
    "name": "file_uploads",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "original_filename",
        "def": "TEXT"
      },
      {
        "name": "mime_type",
        "def": "TEXT"
      },
      {
        "name": "file_size",
        "def": "INTEGER"
      },
      {
        "name": "file_data",
        "def": "BYTEA NOT NULL"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "generic_entities",
    "pk": [
      "id",
      "entity_type"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "entity_type",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "created_date",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_date",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "impersonation_logs",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "admin_email",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "target_company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "target_company_name",
        "def": "TEXT"
      },
      {
        "name": "reason",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "started_at",
        "def": "TIMESTAMPTZ DEFAULT NOW()"
      },
      {
        "name": "ended_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "duration_minutes",
        "def": "INTEGER"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "expires_at",
        "def": "TIMESTAMPTZ NOT NULL"
      },
      {
        "name": "view_as_user_email",
        "def": "TEXT"
      },
      {
        "name": "action_type",
        "def": "TEXT DEFAULT 'impersonation'`)"
      }
    ]
  },
  {
    "name": "invoices",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "customer_name",
        "def": "TEXT"
      },
      {
        "name": "customer_email",
        "def": "TEXT"
      },
      {
        "name": "invoice_number",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'draft'"
      },
      {
        "name": "total_amount",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "amount_paid",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "total_tax",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "deductible_amount",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "due_date",
        "def": "TIMESTAMP"
      },
      {
        "name": "issue_date",
        "def": "TEXT"
      },
      {
        "name": "project_name",
        "def": "TEXT"
      },
      {
        "name": "sale_agent",
        "def": "TEXT"
      },
      {
        "name": "insurance_company",
        "def": "TEXT"
      },
      {
        "name": "claim_number",
        "def": "TEXT"
      },
      {
        "name": "policy_number",
        "def": "TEXT"
      },
      {
        "name": "items",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "tags",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "commission_splits",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "quickbooks_invoice_id",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "labor_rates",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "name",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "category",
        "def": "TEXT"
      },
      {
        "name": "unit",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "rate_cents",
        "def": "INTEGER NOT NULL"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN NOT NULL DEFAULT true"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "leads",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT"
      },
      {
        "name": "phone",
        "def": "TEXT"
      },
      {
        "name": "phone_2",
        "def": "TEXT"
      },
      {
        "name": "address",
        "def": "TEXT"
      },
      {
        "name": "street",
        "def": "TEXT"
      },
      {
        "name": "city",
        "def": "TEXT"
      },
      {
        "name": "state",
        "def": "TEXT"
      },
      {
        "name": "zip",
        "def": "TEXT"
      },
      {
        "name": "company",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'new'"
      },
      {
        "name": "source",
        "def": "TEXT"
      },
      {
        "name": "lead_source",
        "def": "TEXT"
      },
      {
        "name": "assigned_to",
        "def": "TEXT"
      },
      {
        "name": "assigned_to_users",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "service_needed",
        "def": "TEXT"
      },
      {
        "name": "customer_type",
        "def": "TEXT DEFAULT 'residential'"
      },
      {
        "name": "lead_score",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "lead_temperature",
        "def": "TEXT"
      },
      {
        "name": "value",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "tags",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "last_contact_date",
        "def": "TEXT"
      },
      {
        "name": "next_follow_up_date",
        "def": "TEXT"
      },
      {
        "name": "ghl_contact_id",
        "def": "TEXT"
      },
      {
        "name": "communication_count",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "needs_attention",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "contractor_decision",
        "def": "TEXT"
      },
      {
        "name": "claim_number",
        "def": "TEXT"
      },
      {
        "name": "referred_by",
        "def": "TEXT"
      },
      {
        "name": "custom_data",
        "def": "JSONB DEFAULT '{}'"
      }
    ]
  },
  {
    "name": "password_reset_tokens",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "token",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "expires_at",
        "def": "TIMESTAMP NOT NULL"
      },
      {
        "name": "used_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "payments",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "invoice_id",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "customer_name",
        "def": "TEXT"
      },
      {
        "name": "invoice_number",
        "def": "TEXT"
      },
      {
        "name": "payment_number",
        "def": "TEXT"
      },
      {
        "name": "amount",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "payment_method",
        "def": "TEXT"
      },
      {
        "name": "payment_date",
        "def": "TIMESTAMP"
      },
      {
        "name": "reference_number",
        "def": "TEXT"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'completed'"
      },
      {
        "name": "send_receipt",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "category",
        "def": "TEXT"
      },
      {
        "name": "transaction_type",
        "def": "TEXT DEFAULT 'revenue'"
      },
      {
        "name": "quickbooks_payment_id",
        "def": "TEXT"
      },
      {
        "name": "file_url",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "pending_signups",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_name",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "verification_token",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "token_expires_at",
        "def": "TIMESTAMP NOT NULL"
      },
      {
        "name": "is_confirmed",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "project_logs",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "project_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "author_role",
        "def": "TEXT NOT NULL DEFAULT 'admin'"
      },
      {
        "name": "author_name",
        "def": "TEXT"
      },
      {
        "name": "content_body",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "is_public",
        "def": "BOOLEAN NOT NULL DEFAULT false"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP NOT NULL DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "project_photos",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "project_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "photo_url",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "caption",
        "def": "TEXT"
      },
      {
        "name": "milestone",
        "def": "TEXT"
      },
      {
        "name": "is_public",
        "def": "BOOLEAN NOT NULL DEFAULT false"
      },
      {
        "name": "uploaded_by",
        "def": "TEXT"
      },
      {
        "name": "source_media_id",
        "def": "TEXT"
      },
      {
        "name": "source_customer_id",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP NOT NULL DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "projects",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "customer_name",
        "def": "TEXT"
      },
      {
        "name": "title",
        "def": "TEXT"
      },
      {
        "name": "description",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'pending'"
      },
      {
        "name": "start_date",
        "def": "TIMESTAMP"
      },
      {
        "name": "end_date",
        "def": "TIMESTAMP"
      },
      {
        "name": "total_value",
        "def": "NUMERIC(12,2) DEFAULT 0"
      },
      {
        "name": "assigned_to",
        "def": "TEXT"
      },
      {
        "name": "address",
        "def": "TEXT"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "tags",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "project_type",
        "def": "TEXT DEFAULT 'standard'"
      },
      {
        "name": "current_milestone",
        "def": "TEXT"
      },
      {
        "name": "related_customer_id",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "property_measurements",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "invoice_id",
        "def": "TEXT"
      },
      {
        "name": "job_id",
        "def": "TEXT"
      },
      {
        "name": "photo_urls",
        "def": "JSONB NOT NULL DEFAULT '[]'"
      },
      {
        "name": "raw_analysis",
        "def": "JSONB NOT NULL DEFAULT '{}'"
      },
      {
        "name": "siding_sq",
        "def": "NUMERIC(12,2)"
      },
      {
        "name": "trim_linear_ft",
        "def": "NUMERIC(12,2)"
      },
      {
        "name": "roof_pitch",
        "def": "TEXT"
      },
      {
        "name": "window_count",
        "def": "INTEGER"
      },
      {
        "name": "door_count",
        "def": "INTEGER"
      },
      {
        "name": "confidence",
        "def": "NUMERIC(5,2)"
      },
      {
        "name": "status",
        "def": "TEXT NOT NULL DEFAULT 'processing'"
      },
      {
        "name": "error_message",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "sessions",
    "pk": [
      "sid"
    ],
    "columns": [
      {
        "name": "sid",
        "def": "TEXT"
      },
      {
        "name": "sess",
        "def": "JSONB NOT NULL"
      },
      {
        "name": "expire",
        "def": "TIMESTAMP NOT NULL"
      }
    ]
  },
  {
    "name": "signing_sessions",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "SERIAL"
      },
      {
        "name": "base44_session_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "template_id",
        "def": "TEXT"
      },
      {
        "name": "template_name",
        "def": "TEXT"
      },
      {
        "name": "contract_name",
        "def": "TEXT"
      },
      {
        "name": "customer_name",
        "def": "TEXT"
      },
      {
        "name": "customer_email",
        "def": "TEXT"
      },
      {
        "name": "customer_phone",
        "def": "TEXT"
      },
      {
        "name": "delivery_method",
        "def": "TEXT DEFAULT 'email'"
      },
      {
        "name": "rep_name",
        "def": "TEXT"
      },
      {
        "name": "rep_email",
        "def": "TEXT"
      },
      {
        "name": "rep_fields",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "rep_signature_url",
        "def": "TEXT"
      },
      {
        "name": "rep_signed_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "customer_fields",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "customer_signature_data",
        "def": "TEXT"
      },
      {
        "name": "customer_signed_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "signing_token",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'draft'"
      },
      {
        "name": "current_signer",
        "def": "TEXT DEFAULT 'rep'"
      },
      {
        "name": "fillable_fields",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "original_file_url",
        "def": "TEXT"
      },
      {
        "name": "expires_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "sent_to_customer_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "completed_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "html_content",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "lead_id",
        "def": "TEXT"
      },
      {
        "name": "customer_signature_url",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "staff_profiles",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "full_name",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT"
      },
      {
        "name": "user_email",
        "def": "TEXT"
      },
      {
        "name": "role",
        "def": "TEXT"
      },
      {
        "name": "role_id",
        "def": "TEXT"
      },
      {
        "name": "position",
        "def": "TEXT"
      },
      {
        "name": "phone",
        "def": "TEXT"
      },
      {
        "name": "cell_phone",
        "def": "TEXT"
      },
      {
        "name": "avatar_url",
        "def": "TEXT"
      },
      {
        "name": "call_routing_mode",
        "def": "TEXT DEFAULT 'sarah_answers'"
      },
      {
        "name": "availability_status",
        "def": "TEXT DEFAULT 'available'"
      },
      {
        "name": "twilio_number",
        "def": "TEXT"
      },
      {
        "name": "is_administrator",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "is_super_admin",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "commission_rate",
        "def": "NUMERIC(5,2) DEFAULT 0"
      },
      {
        "name": "whatsapp_enabled",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "profile_id",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "last_login",
        "def": "TIMESTAMP"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "preferred_language",
        "def": "TEXT DEFAULT NULL"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "commission_notify_email",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "commission_notify_sms",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "commission_notify_bell",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "commission_notify_weekly_digest",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "leaderboard_digest_email",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "commission_notify_modified_by",
        "def": "TEXT"
      },
      {
        "name": "commission_notify_modified_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "invite_sent",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "invite_sent_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "status",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "staff_score_events",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "staff_email",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "staff_name",
        "def": "TEXT"
      },
      {
        "name": "event_type",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "points",
        "def": "INTEGER NOT NULL DEFAULT 0"
      },
      {
        "name": "entity_type",
        "def": "TEXT"
      },
      {
        "name": "entity_id",
        "def": "TEXT"
      },
      {
        "name": "description",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "subcontractor_rates",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "subcontractor_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "labor_rate_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "custom_rate",
        "def": "NUMERIC(12,2) NOT NULL"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "sync_status",
    "pk": [
      "entity_type"
    ],
    "columns": [
      {
        "name": "entity_type",
        "def": "TEXT"
      },
      {
        "name": "last_synced_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "record_count",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'idle'"
      },
      {
        "name": "error",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "tasks",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "title",
        "def": "TEXT"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "description",
        "def": "TEXT"
      },
      {
        "name": "status",
        "def": "TEXT DEFAULT 'pending'"
      },
      {
        "name": "priority",
        "def": "TEXT DEFAULT 'medium'"
      },
      {
        "name": "assigned_to",
        "def": "TEXT"
      },
      {
        "name": "assigned_to_name",
        "def": "TEXT"
      },
      {
        "name": "assigned_to_avatar",
        "def": "TEXT"
      },
      {
        "name": "assignees",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "due_date",
        "def": "TIMESTAMP"
      },
      {
        "name": "related_to",
        "def": "TEXT"
      },
      {
        "name": "customer_id",
        "def": "TEXT"
      },
      {
        "name": "customer_name",
        "def": "TEXT"
      },
      {
        "name": "board_id",
        "def": "TEXT"
      },
      {
        "name": "column",
        "def": "TEXT"
      },
      {
        "name": "checklist_items",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "comments",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "files",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "followers",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "reminders",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "timesheets",
        "def": "JSONB DEFAULT '[]'"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "synced_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "transaction_mapping_rules",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "pattern",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "category",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "transaction_type",
        "def": "TEXT NOT NULL DEFAULT 'expense'"
      },
      {
        "name": "priority",
        "def": "INTEGER DEFAULT 0"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "notes",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "users",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "phone",
        "def": "TEXT"
      },
      {
        "name": "gmail_connected",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "gmail_access_token",
        "def": "TEXT"
      },
      {
        "name": "gmail_refresh_token",
        "def": "TEXT"
      },
      {
        "name": "gmail_token_expires_at",
        "def": "TIMESTAMP WITH TIME ZONE"
      },
      {
        "name": "gmail_email",
        "def": "TEXT"
      },
      {
        "name": "google_calendar_reconnect_needed",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "google_disconnect_alerted_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "microsoft_disconnect_alerted_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT"
      },
      {
        "name": "first_name",
        "def": "TEXT"
      },
      {
        "name": "last_name",
        "def": "TEXT"
      },
      {
        "name": "profile_image_url",
        "def": "TEXT"
      },
      {
        "name": "password_hash",
        "def": "TEXT"
      },
      {
        "name": "is_local_auth",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "must_change_password",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "platform_role",
        "def": "TEXT DEFAULT NULL"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "google_calendar_connected",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "google_access_token",
        "def": "TEXT"
      },
      {
        "name": "google_refresh_token",
        "def": "TEXT"
      },
      {
        "name": "google_token_expires_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "google_sync_enabled",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "microsoft_calendar_connected",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "microsoft_access_token",
        "def": "TEXT"
      },
      {
        "name": "microsoft_refresh_token",
        "def": "TEXT"
      },
      {
        "name": "microsoft_token_expires_at",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "microsoft_sync_enabled",
        "def": "BOOLEAN DEFAULT false"
      },
      {
        "name": "last_google_sync",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "last_microsoft_sync",
        "def": "TIMESTAMPTZ"
      },
      {
        "name": "full_name",
        "def": "TEXT"
      }
    ]
  },
  {
    "name": "work_order_completion_photos",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "work_order_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "file_url",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "original_filename",
        "def": "TEXT"
      },
      {
        "name": "mime_type",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "file_size",
        "def": "INTEGER NOT NULL"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "work_order_items",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "work_order_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "labor_rate_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "description",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "unit",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "quantity",
        "def": "NUMERIC(12,3) NOT NULL"
      },
      {
        "name": "unit_rate_cents",
        "def": "INTEGER NOT NULL"
      },
      {
        "name": "total_cents",
        "def": "INTEGER NOT NULL"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "work_orders",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "project_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "subcontractor_id",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "work_order_number",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "title",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "scope_of_work",
        "def": "TEXT"
      },
      {
        "name": "payout_cents",
        "def": "INTEGER NOT NULL"
      },
      {
        "name": "status",
        "def": "TEXT NOT NULL DEFAULT 'pending'"
      },
      {
        "name": "access_token",
        "def": "TEXT NOT NULL"
      },
      {
        "name": "completion_notes",
        "def": "TEXT"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "accepted_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "completed_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "approved_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "paid_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "invite_delivery_method",
        "def": "TEXT"
      },
      {
        "name": "invite_delivery_status",
        "def": "TEXT"
      },
      {
        "name": "invite_delivered_at",
        "def": "TIMESTAMP"
      },
      {
        "name": "invite_delivery_error",
        "def": "TEXT"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  },
  {
    "name": "inspector_profiles",
    "pk": [
      "id"
    ],
    "columns": [
      {
        "name": "id",
        "def": "TEXT"
      },
      {
        "name": "base44_id",
        "def": "TEXT"
      },
      {
        "name": "company_id",
        "def": "TEXT"
      },
      {
        "name": "name",
        "def": "TEXT"
      },
      {
        "name": "full_name",
        "def": "TEXT"
      },
      {
        "name": "email",
        "def": "TEXT"
      },
      {
        "name": "user_email",
        "def": "TEXT"
      },
      {
        "name": "phone",
        "def": "TEXT"
      },
      {
        "name": "is_active",
        "def": "BOOLEAN DEFAULT true"
      },
      {
        "name": "created_by",
        "def": "TEXT"
      },
      {
        "name": "data",
        "def": "JSONB DEFAULT '{}'"
      },
      {
        "name": "created_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      },
      {
        "name": "updated_at",
        "def": "TIMESTAMP DEFAULT NOW()"
      }
    ]
  }
];

const UNIQUE_INDEXES = [
  [
    "companies",
    [
      "base44_id"
    ]
  ],
  [
    "staff_profiles",
    [
      "base44_id"
    ]
  ],
  [
    "leads",
    [
      "base44_id"
    ]
  ],
  [
    "customers",
    [
      "base44_id"
    ]
  ],
  [
    "estimates",
    [
      "base44_id"
    ]
  ],
  [
    "invoices",
    [
      "base44_id"
    ]
  ],
  [
    "payments",
    [
      "base44_id"
    ]
  ],
  [
    "projects",
    [
      "base44_id"
    ]
  ],
  [
    "tasks",
    [
      "base44_id"
    ]
  ],
  [
    "calendar_events",
    [
      "base44_id"
    ]
  ],
  [
    "communications",
    [
      "base44_id"
    ]
  ],
  [
    "users",
    [
      "email"
    ]
  ],
  [
    "pending_signups",
    [
      "email"
    ]
  ],
  [
    "pending_signups",
    [
      "verification_token"
    ]
  ],
  [
    "signing_sessions",
    [
      "signing_token"
    ]
  ],
  [
    "credit_grants",
    [
      "session_id"
    ]
  ],
  [
    "work_orders",
    [
      "access_token"
    ]
  ],
  [
    "password_reset_tokens",
    [
      "token"
    ]
  ],
  [
    "subcontractor_rates",
    [
      "subcontractor_id",
      "labor_rate_id"
    ]
  ]
];

function alterDef(def) {
  let sql = String(def || 'TEXT');
  const tick = sql.indexOf('`');
  if (tick >= 0) sql = sql.slice(0, tick);
  sql = sql
    .replace(/\bNOT NULL\b/gi, '')
    .replace(/\bPRIMARY KEY\b/gi, '')
    .replace(/\bUNIQUE\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A template-literal closer can leave a spare ")" after the type.
  while (((sql.match(/\(/g) || []).length < (sql.match(/\)/g) || []).length) && sql.endsWith(')')) {
    sql = sql.slice(0, -1).trim();
  }
  return sql || 'TEXT';
}

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error('Unsafe identifier: ' + name);
  }
  return '"' + name + '"';
}

async function ensureSchema(pool) {
  let addedTables = 0;
  let addedColumns = 0;
  for (const table of TABLES) {
    const tname = quoteIdent(table.name);
    const pk = table.pk && table.pk.length ? table.pk : [];
    const byName = new Map(table.columns.map((col) => [col.name, col]));
    if (pk.length === 0) throw new Error('No primary key for ' + table.name);
    const pkSql = pk.map((name) => {
      const col = byName.get(name);
      if (!col) throw new Error(table.name + ' primary key column missing from catalog: ' + name);
      return quoteIdent(name) + ' ' + alterDef(col.def);
    }).join(', ');
    const before = await pool.query('SELECT to_regclass($1) AS rel', [table.name]);
    const existed = !!before.rows[0].rel;
    await pool.query(
      'CREATE TABLE IF NOT EXISTS ' + tname + ' (' + pkSql + ', PRIMARY KEY (' + pk.map(quoteIdent).join(', ') + '))'
    );
    if (!existed) addedTables++;
    for (const col of table.columns) {
      if (pk.includes(col.name)) continue;
      const probe = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [table.name, col.name]
      );
      if (probe.rows.length > 0) continue;
      await pool.query(
        'ALTER TABLE ' + tname + ' ADD COLUMN IF NOT EXISTS ' + quoteIdent(col.name) + ' ' + alterDef(col.def)
      );
      addedColumns++;
    }
  }

  for (const [table, cols] of UNIQUE_INDEXES) {
    const index = 'ensure_' + table + '_' + cols.join('_') + '_uniq';
    try {
      await pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS ' + quoteIdent(index) +
        ' ON ' + quoteIdent(table) + ' (' + cols.map(quoteIdent).join(', ') + ')'
      );
    } catch (err) {
      console.warn('[ensure-schema] unique index ' + index + ' skipped: ' + err.message);
    }
  }

  console.log('[ensure-schema] tables=' + TABLES.length + ' created=' + addedTables + ' columns_added=' + addedColumns);
}

module.exports = { ensureSchema, TABLES, UNIQUE_INDEXES };
