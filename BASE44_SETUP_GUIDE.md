# Base44 Setup Guide - CompanySync Roofing Platform

## 1. ENTITIES (Database Tables)

Create ALL of the following entities in your Base44 dashboard. Each entity needs the fields listed. All entities should have `company_id` (text) for multi-tenant data isolation unless noted otherwise.

### Core Business Entities

**Company**
- company_name (text)
- email (text)
- phone (text)
- address (text)
- city (text)
- state (text)
- zip (text)
- logo_url (text)
- website (text)
- industry (text)
- license_number (text)
- created_by (text) — user email of owner
- is_deleted (boolean)
- branding (object) — colors, logo settings
- settings (object) — general company config

**StaffProfile**
- user_email (text)
- company_id (text)
- full_name (text)
- phone (text)
- cell_phone (text)
- role (text) — admin, sales_rep, inspector, etc.
- role_id (text) — links to StaffRole
- avatar_url (text)
- is_active (boolean)
- call_routing_mode (text) — forward_to_cell, sarah_answers, sarah_then_transfer
- availability_status (text) — available, unavailable
- color (text) — assigned color for calendar
- tour_completed (boolean)
- commission_rate (number)

**StaffRole**
- company_id (text)
- name (text)
- permissions (object) — feature access flags
- is_default (boolean)

**Lead**
- company_id (text)
- full_name (text)
- email (text)
- phone (text)
- address (text)
- city (text)
- state (text)
- zip (text)
- source (text) — website, referral, door_knock, etc.
- status (text) — new, contacted, qualified, won, lost
- assigned_to (text)
- notes (text)
- score (number)
- latitude (number)
- longitude (number)
- is_deleted (boolean)
- created_date (text)
- ghl_contact_id (text)
- customer_number (text)

**Customer**
- company_id (text)
- full_name (text)
- email (text)
- phone (text)
- address (text)
- city (text)
- state (text)
- zip (text)
- customer_number (text)
- lead_id (text)
- notes (text)
- tags (text array)
- is_deleted (boolean)
- latitude (number)
- longitude (number)

**Estimate**
- company_id (text)
- customer_id (text)
- lead_id (text)
- estimate_number (text)
- title (text)
- status (text) — draft, sent, approved, rejected
- line_items (object array)
- subtotal (number)
- tax (number)
- total (number)
- notes (text)
- valid_until (text)
- created_date (text)
- pdf_url (text)
- xactimate_data (object)

**Invoice**
- company_id (text)
- customer_id (text)
- estimate_id (text)
- invoice_number (text)
- status (text) — draft, sent, paid, overdue, partial
- line_items (object array)
- subtotal (number)
- tax (number)
- total (number)
- amount_paid (number)
- balance_due (number)
- due_date (text)
- sent_date (text)
- paid_date (text)
- notes (text)
- pdf_url (text)
- stripe_payment_link (text)
- commission_amount (number)
- commission_status (text)

**Payment**
- company_id (text)
- invoice_id (text)
- customer_id (text)
- amount (number)
- payment_method (text)
- payment_date (text)
- reference_number (text)
- notes (text)
- status (text)
- stripe_payment_id (text)
- payment_number (text)

**Project**
- company_id (text)
- customer_id (text)
- estimate_id (text)
- name (text)
- status (text) — planning, in_progress, completed
- start_date (text)
- end_date (text)
- assigned_crew (text array)
- notes (text)
- address (text)

### Task Management

**TaskBoard**
- company_id (text)
- name (text)
- columns (object array) — board column definitions
- is_default (boolean)

**Task**
- company_id (text)
- board_id (text)
- column (text)
- title (text)
- description (text)
- priority (text) — low, medium, high, urgent
- assigned_to (text)
- due_date (text)
- customer_id (text)
- lead_id (text)
- tags (text array)
- position (number)
- is_completed (boolean)
- completed_date (text)

### Calendar & Communication

**CalendarEvent**
- company_id (text)
- title (text)
- description (text)
- start_time (text)
- end_time (text)
- location (text)
- attendees (text array)
- event_type (text) — inspection, meeting, follow_up
- customer_id (text)
- lead_id (text)
- assigned_to (text)
- google_event_id (text)
- google_calendar_id (text)
- color (text)
- is_all_day (boolean)
- recurrence (text)

**Communication**
- company_id (text)
- type (text) — call, sms, email, note
- direction (text) — inbound, outbound
- contact_name (text)
- contact_phone (text)
- contact_email (text)
- subject (text)
- body (text)
- duration (number)
- status (text)
- lead_id (text)
- customer_id (text)
- staff_id (text)
- recording_url (text)
- created_date (text)

**ConversationHistory**
- company_id (text)
- session_id (text)
- messages (object array)
- caller_phone (text)
- assistant_type (text) — sarah, lexi, marcus
- created_date (text)
- summary (text)

**Message**
- company_id (text)
- thread_id (text)
- sender (text)
- content (text)
- type (text)
- read (boolean)
- created_date (text)

**Notification**
- company_id (text)
- user_email (text)
- title (text)
- message (text)
- type (text)
- is_read (boolean)
- link (text)
- created_date (text)

**NotificationPreference**
- company_id (text)
- user_email (text)
- preferences (object) — notification channel settings

### Inspections & AI

**InspectionJob**
- company_id (text)
- customer_id (text)
- lead_id (text)
- inspector_id (text)
- status (text) — scheduled, in_progress, completed
- address (text)
- scheduled_date (text)
- photos (object array) — photo URLs with AI analysis results
- damage_types (text array)
- ai_analysis (object)
- storm_event_id (text)
- notes (text)
- report_url (text)

**InspectorProfile**
- company_id (text)
- user_email (text)
- full_name (text)
- certifications (text array)
- areas_covered (text array)

**InspectionReportTemplate**
- company_id (text)
- name (text)
- template_data (object)

**DroneInspection**
- company_id (text)
- customer_id (text)
- address (text)
- status (text)
- photos (object array)
- analysis (object)
- report_url (text)

**DamageReferencePhoto**
- company_id (text)
- damage_type (text)
- photo_url (text)
- description (text)
- labels (object array)

### Contracts & Documents

**ContractTemplate**
- company_id (text)
- name (text)
- content (text) — HTML/rich text template
- fields (object array) — dynamic field definitions
- is_default (boolean)

**ContractSigningSession**
- company_id (text)
- contract_template_id (text)
- customer_id (text)
- estimate_id (text)
- status (text) — pending, signed, expired
- field_values (object)
- customer_signature (text)
- rep_signature (text)
- signed_date (text)
- pdf_url (text)
- token (text) — unique signing link token

**Contract**
- company_id (text)
- template_id (text)
- customer_id (text)
- status (text)
- signed_pdf_url (text)
- signed_date (text)

**Document**
- company_id (text)
- name (text)
- file_url (text)
- type (text)
- customer_id (text)
- task_id (text)

**Signature**
- company_id (text)
- signer_name (text)
- signer_email (text)
- signature_data (text)
- document_id (text)
- signed_date (text)

### Templates

**EmailTemplate**
- company_id (text)
- name (text)
- subject (text)
- body (text)
- category (text)

**SMSTemplate**
- company_id (text)
- name (text)
- body (text)
- category (text)

**EstimateTemplate**
- company_id (text)
- name (text)
- line_items (object array)
- category (text)

**EstimateFormat**
- company_id (text)
- name (text)
- format_config (object)

### Pricing & Items

**PriceListItem**
- company_id (text)
- category (text)
- description (text)
- unit (text)
- unit_price (number)
- xactimate_code (text)
- source (text)

**Item**
- company_id (text)
- name (text)
- description (text)
- price (number)
- unit (text)
- category (text)

**TaxRate**
- company_id (text)
- name (text)
- rate (number)
- is_default (boolean)

### Financial / Accounting

**ChartOfAccounts**
- company_id (text)
- account_number (text)
- account_name (text)
- account_type (text) — asset, liability, equity, revenue, expense
- parent_id (text)
- balance (number)
- is_active (boolean)

**Transaction**
- company_id (text)
- date (text)
- description (text)
- amount (number)
- type (text) — debit, credit
- account_id (text)
- reference (text)
- category (text)

**Expense**
- company_id (text)
- description (text)
- amount (number)
- date (text)
- category (text)
- vendor (text)
- receipt_url (text)
- account_id (text)
- status (text)

**Payout**
- company_id (text)
- amount (number)
- recipient (text)
- date (text)
- method (text)
- status (text)
- reference (text)

**BankAccount**
- company_id (text)
- name (text)
- account_number (text)
- routing_number (text)
- bank_name (text)
- account_type (text)
- balance (number)

### Commission Tracking

**CommissionRule**
- company_id (text)
- name (text)
- type (text)
- rate (number)
- conditions (object)

**CommissionPayment**
- company_id (text)
- staff_id (text)
- invoice_id (text)
- amount (number)
- status (text)
- paid_date (text)

**CommissionDeduction**
- company_id (text)
- staff_id (text)
- amount (number)
- reason (text)
- date (text)

**FamilyMember**
- company_id (text)
- parent_company_id (text)
- member_company_id (text)
- relationship (text)
- commission_rate (number)

**FamilyCommissionRecord**
- company_id (text)
- source_invoice_id (text)
- amount (number)
- status (text)
- paid_date (text)

### Workflows & Automation

**Workflow**
- company_id (text)
- name (text)
- trigger (object) — event trigger config
- actions (object array) — action steps
- is_active (boolean)

**WorkflowExecution**
- company_id (text)
- workflow_id (text)
- status (text)
- started_at (text)
- completed_at (text)
- results (object)
- error (text)

### Integrations & Settings

**TwilioSettings**
- company_id (text)
- account_sid (text)
- auth_token (text)
- main_phone_number (text)
- webhook_configured (boolean)
- voice_webhook_url (text)
- sms_webhook_url (text)

**AssistantSettings**
- company_id (text)
- assistant_type (text) — sarah, lexi, marcus
- settings (object) — voice, personality, tools config
- is_active (boolean)
- greeting (text)
- system_prompt (text)

**IntegrationSetting**
- company_id (text)
- integration_type (text) — ghl, abc_supply, quickbooks
- credentials (object)
- settings (object)
- is_active (boolean)

**IntegrationCredential**
- company_id (text)
- provider (text)
- access_token (text)
- refresh_token (text)
- expires_at (text)
- metadata (object)

**GoogleChatSettings**
- company_id (text)
- webhook_url (text)
- is_active (boolean)

**SlackSettings**
- company_id (text)
- webhook_url (text)
- channel (text)
- is_active (boolean)

**QuickBooksSettings**
- company_id (text)
- realm_id (text)
- access_token (text)
- refresh_token (text)
- is_connected (boolean)

**RoundRobinSettings**
- company_id (text)
- is_active (boolean)
- staff_order (text array)
- current_index (number)

### Subscriptions & Billing

**SubscriptionPlan**
- name (text)
- price (number)
- features (object)
- limits (object) — leads, users, calls, etc.
- stripe_price_id (text)
- is_active (boolean)
(No company_id — these are platform-level)

**CompanySubscription**
- company_id (text)
- plan_id (text)
- status (text)
- stripe_subscription_id (text)
- current_period_start (text)
- current_period_end (text)
- trial_end (text)

**SubscriptionUsage**
- company_id (text)
- period (text)
- leads_count (number)
- users_count (number)
- ai_minutes (number)
- calls_count (number)
- storage_mb (number)

### Storms & Weather

**StormEvent**
- company_id (text)
- name (text)
- date (text)
- type (text) — hail, wind, tornado
- severity (text)
- affected_area (object) — lat/lng bounds
- zip_codes (text array)
- notes (text)

**StormAlertSettings**
- company_id (text)
- is_active (boolean)
- alert_types (text array)
- notification_methods (text array)
- zip_codes (text array)

### Knowledge Base & Training

**KnowledgeBaseArticle**
- company_id (text)
- title (text)
- content (text)
- category (text)
- tags (text array)
- is_published (boolean)

**AITrainingData**
- company_id (text)
- category (text)
- question (text)
- answer (text)
- source (text)

**TrainingVideo**
- company_id (text)
- title (text)
- description (text)
- video_url (text)
- thumbnail_url (text)
- duration (number)
- category (text)
- article_id (text)

### Marketing

**Campaign**
- company_id (text)
- name (text)
- type (text) — email, sms, social
- status (text) — draft, active, completed
- audience (object)
- content (object)
- scheduled_date (text)
- sent_count (number)
- open_count (number)

**ReviewRequest**
- company_id (text)
- customer_id (text)
- invoice_id (text)
- status (text) — pending, sent, completed
- review_link (text)
- sent_date (text)
- rating (number)

**EmailTracking**
- company_id (text)
- email_id (text)
- recipient (text)
- opened (boolean)
- opened_date (text)
- clicked (boolean)

### Territories & Location

**Territory**
- company_id (text)
- name (text)
- boundaries (object) — GeoJSON polygon
- assigned_to (text)
- zip_codes (text array)
- color (text)

**RepLocation**
- company_id (text)
- staff_id (text)
- latitude (number)
- longitude (number)
- last_updated (text)

**FieldActivity**
- company_id (text)
- staff_id (text)
- type (text) — door_knock, site_visit
- address (text)
- latitude (number)
- longitude (number)
- notes (text)
- created_date (text)

### Property Data

**Property**
- company_id (text)
- address (text)
- owner_name (text)
- owner_phone (text)
- owner_email (text)
- roof_data (object) — measurements, material, age
- solar_data (object) — from Google Solar API
- latitude (number)
- longitude (number)

### Misc / Platform

**AIMemory**
- company_id (text)
- assistant_type (text)
- key (text)
- value (text)
- context (text)

**BetaQuestionnaire**
- company_id (text)
- responses (object)
- submitted_date (text)

**BuildingCode**
- state (text)
- code (text)
- description (text)
- requirements (text)
(No company_id — platform-level reference data)

**CompanyProfile**
- company_id (text)
- about (text)
- services (text array)
- service_areas (text array)
- certifications (text array)

**CompanySetting**
- company_id (text)
- key (text)
- value (text)

**CompleteBackup**
- company_id (text)
- backup_data (object)
- created_date (text)
- size (number)

**CustomField**
- company_id (text)
- entity_type (text)
- field_name (text)
- field_type (text)
- options (text array)
- is_required (boolean)

**CustomerGroup**
- company_id (text)
- name (text)
- criteria (object)

**DailyReport**
- company_id (text)
- date (text)
- summary (text)
- metrics (object)
- generated_by (text)

**DashboardSettings**
- company_id (text)
- layout (object)
- widgets (object array)

**EstimateVersion**
- company_id (text)
- estimate_id (text)
- version_number (number)
- data (object)
- created_date (text)

**ImpersonationLog**
- admin_email (text)
- target_company_id (text)
- action (text)
- timestamp (text)
(No company_id — platform-level)

**ImportLog**
- company_id (text)
- type (text)
- status (text)
- records_imported (number)
- errors (object array)

**JobMedia**
- company_id (text)
- job_id (text)
- file_url (text)
- type (text)
- caption (text)

**LeadScore**
- company_id (text)
- lead_id (text)
- score (number)
- factors (object)

**LeadSource**
- company_id (text)
- name (text)
- type (text)
- is_active (boolean)

**MenuSettings**
- company_id (text)
- menu_config (object) — per-company menu customization

**PlatformMenuSettings**
- menu_config (object) — platform-level menu defaults
(No company_id — platform-level)

**Proposal**
- company_id (text)
- customer_id (text)
- estimate_id (text)
- title (text)
- content (text)
- status (text)
- pdf_url (text)

**RevenueGoal**
- company_id (text)
- period (text)
- target (number)
- actual (number)

**SavedReport**
- company_id (text)
- name (text)
- type (text)
- config (object)

**Subcontractor**
- company_id (text)
- name (text)
- trade (text)
- phone (text)
- email (text)
- insurance_expiry (text)
- license_number (text)
- rating (number)

**User**
- email (text)
- name (text)
- role (text)
(Platform-level, managed by Base44 auth)

**Vendor**
- company_id (text)
- name (text)
- contact (text)
- phone (text)
- email (text)
- category (text)

---

## 2. SERVERLESS FUNCTIONS

Upload ALL `.ts` files from the `functions/` directory to Base44's serverless functions. Each file is a self-contained Deno function.

### Critical Functions (Required for core features)

| Function | Purpose |
|----------|---------|
| `autoSetupCompany` | Creates company, staff profile, default settings on signup |
| `createCheckoutSession` | Stripe subscription checkout |
| `createGeminiEphemeralToken` | Generates Gemini API tokens for AI features |
| `analyzeCrewCamPhoto` | AI photo analysis for roof damage |
| `analyzeCrewCamPhotoAdvanced` | Advanced multi-pass damage detection |
| `generateEstimatePDF` | PDF generation for estimates |
| `generateInvoicePDF` | PDF generation for invoices |
| `sendEmailFromCRM` | Email sending from CRM |
| `sendSMS` | SMS sending via Twilio |
| `sarahBridgeAPI` | AI voice assistant CRM tools |
| `lexiChat` | Browser AI assistant backend |
| `checkSubscriptionLimits` | Enforce subscription limits |
| `syncGoogleCalendar` | Google Calendar sync |
| `connectGoogleCalendar` | Google OAuth callback |
| `createConnectedAccount` | Stripe Connect setup |
| `getSigningSession` | Contract signing session retrieval |
| `signContractCustomer` | Customer contract signing |
| `sendContractSigningLink` | Email signing links |
| `geocodeAddress` | Address geocoding |
| `updateMyProfile` | User profile updates |
| `triggerWorkflow` | Execute automation workflows |

### Cron/Scheduled Functions (Set up as recurring)

| Function | Schedule | Purpose |
|----------|----------|---------|
| `cronAutoSyncCalendars` | Every 15 min | Sync Google Calendars |
| `cronDailyBackup` | Daily at midnight | Automatic data backups |
| `cronRenewCalendarWatches` | Daily | Renew Google Calendar watch subscriptions |
| `checkInvoiceReminders` | Daily | Send overdue invoice reminders |
| `checkTaskReminders` | Every hour | Task due date reminders |
| `autoGenerateDailyReport` | Daily at 6 PM | Generate daily summary reports |
| `decayLeadScores` | Daily | Decay old lead scores |
| `autoCallNewLeads` | Every 5 min | Auto-call new leads via Sarah |
| `runReviewRequestsNow` | Daily | Send review requests for completed jobs |
| `weeklyDataHealthCheck` | Weekly | Data integrity checks |

### Webhook Functions (External services call these)

| Function | Triggered By |
|----------|-------------|
| `stripeWebhook` | Stripe payment events |
| `customerPortalPaymentWebhook` | Customer portal payments |
| `thoughtlyWebhook` | Thoughtly AI calls |
| `tiktokLeadsWebhook` | TikTok lead ads |
| `zapierWebhook` | Zapier automations |
| `ghlWebhook` | GoHighLevel CRM |
| `crewcamEmailWebhook` | Email-forwarded inspection photos |
| `abcSupplyCallback` | ABC Supply order updates |
| `callStatusWebhook` | Twilio call status updates |

---

## 3. ENVIRONMENT SECRETS

Set these secrets/environment variables in Base44's function configuration:

| Secret | Purpose |
|--------|---------|
| `GOOGLE_GEMINI_API_KEY` | Google Gemini AI (photo analysis, voice) |
| `GOOGLE_MAPS_API_KEY` | Geocoding, Maps, Solar API |
| `GOOGLE_CLIENT_ID` | Google OAuth (Calendar sync) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth (Calendar sync) |
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `RESEND_API_KEY` | Email sending via Resend |
| `BRIDGE_SECRET` | Auth between Replit dev server and Base44 functions |
| `POE_API_KEY` | Poe AI for multi-photo analysis (optional) |

---

## 4. APP CONFIGURATION

In your Base44 app settings:

1. **App ID**: Your Base44 app ID (used in `VITE_BASE44_APP_ID` env var)
2. **Authentication**: Enable Base44 auth with email/password and Google login
3. **File Storage**: Enable for photo uploads (CrewCam, documents)
4. **CORS**: Allow your Replit domain and production domain

---

## 5. DEPLOYMENT NOTES

### Replit Dev Server (vite-twilio-ws-plugin.js)
The Replit development server handles these endpoints locally:
- `/twiml/voice` — Twilio inbound call webhook
- `/twiml/outbound` — Outbound call TwiML
- `/ws/twilio` — WebSocket bridge for Sarah AI voice
- `/ws/lexi-native` — WebSocket bridge for Lexi browser voice
- `/api/whatsapp-webhook` — WhatsApp message handling
- `/api/sarah-missed-call` — Missed call handling
- `/api/messaging-settings` — Messaging toggle settings
- `/api/twilio/auto-provision` — Twilio webhook auto-config
- `/api/twilio/voice` — Production voice webhook
- `/api/twilio/update-cache` — Cache refresh endpoint

### Production Server (prod-server.cjs)
The production server (`prod-server.cjs`) handles the same endpoints for the published app at `companysync.replit.app`.

### Twilio Configuration
Each subscriber provides their own Twilio credentials (stored in `TwilioSettings` entity). The auto-provision endpoint sets these webhooks on their Twilio number:
- Voice URL: `https://companysync.replit.app/api/twilio/voice`
- SMS URL: `https://companysync.replit.app/api/twilio/voice` (same endpoint handles SMS)
- Status Callback: `https://companysync.replit.app/api/twilio/status`
