'use strict';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function buildLexiAccessPolicy({ company, userProfile, effectiveEmail }) {
  const email = normalizeEmail(effectiveEmail);
  const isOwner = email && normalizeEmail(company?.created_by) === email;
  // Do not coerce database/API values here.  A legacy string such as "false"
  // is truthy in JavaScript and must never turn a rep into a Lexi admin.
  const isAdmin = Boolean(
    isOwner ||
    userProfile?.is_administrator === true ||
    userProfile?.is_super_admin === true
  );
  return { email, isAdmin };
}

function accessDenied(message = 'I can help with your own assigned work and sales, but I can’t share that company-wide or another team member’s information.') {
  return { success: false, code: 'LEXI_ACCESS_DENIED', error: message };
}

function ownRecordCondition(entity, emailPlaceholder = '$2') {
  const email = `LOWER(${emailPlaceholder})`;
  switch (entity) {
    case 'leads':
      return `(LOWER(COALESCE(assigned_to, '')) = ${email} OR COALESCE(assigned_to_users, '[]'::jsonb) @> jsonb_build_array(to_jsonb(${emailPlaceholder}::text)) OR LOWER(COALESCE(created_by, '')) = ${email})`;
    case 'customers':
      // customers does not have a created_by column in production. Keep this
      // filter portable and fail closed to assigned customer records rather
      // than making all non-admin Lexi requests crash at query time.
      return `(LOWER(COALESCE(assigned_to, '')) = ${email} OR COALESCE(assigned_to_users, '[]'::jsonb) @> jsonb_build_array(to_jsonb(${emailPlaceholder}::text)))`;
    case 'tasks':
      return `(LOWER(COALESCE(assigned_to, '')) = ${email} OR COALESCE(assignees, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('email', ${emailPlaceholder}::text)) OR LOWER(COALESCE(created_by, '')) = ${email})`;
    case 'projects':
      return `(LOWER(COALESCE(assigned_to, '')) = ${email} OR LOWER(COALESCE(created_by, '')) = ${email})`;
    case 'calendar_events':
      return `(LOWER(COALESCE(assigned_to, '')) = ${email} OR LOWER(COALESCE(attendees, '')) LIKE '%' || ${email} || '%' OR LOWER(COALESCE(created_by, '')) = ${email})`;
    case 'build_schedules':
      // BuildSchedule is stored in generic_entities. New Lexi-created builds
      // always persist created_by and assigned_to_users in data.
      return `(LOWER(COALESCE(data->>'created_by', '')) = ${email} OR LOWER(COALESCE(data->>'rep_email', '')) = ${email} OR COALESCE(data->'assigned_to_users', '[]'::jsonb) @> jsonb_build_array(to_jsonb(${emailPlaceholder}::text)))`;
    case 'estimates':
      return `(LOWER(COALESCE(created_by, '')) = ${email} OR EXISTS (SELECT 1 FROM customers lexi_scope_customer WHERE lexi_scope_customer.company_id = estimates.company_id AND (lexi_scope_customer.id::text = estimates.customer_id::text OR LOWER(COALESCE(lexi_scope_customer.name, '')) = LOWER(COALESCE(estimates.customer_name, ''))) AND ${ownRecordCondition('customers', emailPlaceholder)}))`;
    default:
      return null;
  }
}

function canUseCrmDataType(policy, dataType) {
  if (policy.isAdmin) return true;
  return ['leads', 'customers', 'tasks', 'projects', 'calendar_events', 'estimates'].includes(dataType);
}

function isRestrictedRepTool(toolName) {
  return [
    'lookup_customer_by_phone',
    'get_customer_build_schedule',
    'get_build_schedule',
    'get_customer_open_tasks',
    'get_photosync_jobs',
  ].includes(toolName);
}

function isPermittedRepTool(toolName) {
  // Every other Lexi tool either exposes company-wide data or can mutate a
  // record selected by arbitrary ID/name. Keep this deliberately small until
  // each tool has a record-level ownership check.
  return ['get_crm_data', 'get_calendar_events', 'get_staff_sales_summary', 'find_documents', 'get_customer_payment_status', 'get_build_schedule', 'create_build_schedule'].includes(toolName);
}

module.exports = {
  accessDenied,
  buildLexiAccessPolicy,
  canUseCrmDataType,
  isRestrictedRepTool,
  isPermittedRepTool,
  normalizeEmail,
  ownRecordCondition,
};