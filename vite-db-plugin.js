import { createRequire } from 'node:module';
import { initDatabase, getPool } from './db/schema.js';
import { syncEntityBatch, syncCallRoutingCache, getSyncStatus } from './db/sync.js';
import { getDashboardData, getEntityList, getCallRouting, getStaffByTwilioNumber, getReportingData } from './db/queries.js';
import { notifyAdmins, getEntityNotificationConfig } from './vite-notification-helper.js';
import { functionHandlers, executeWorkflowAction } from './vite-functions-plugin.js';

const nodeRequire = createRequire(import.meta.url);
const tenantGuard = nodeRequire('./lib/tenantGuard.cjs');
const invoiceCustomerLink = nodeRequire('./lib/invoiceCustomerLink.cjs');
const rateLimit = nodeRequire('./lib/rateLimit.cjs');
const chatBot = nodeRequire('./lib/chatBot.cjs');
const insuranceClaimWelcome = nodeRequire('./lib/insuranceClaimWelcome.cjs');
const bulkDeletion = nodeRequire('./lib/bulkDeletion.cjs');

function sendNewClaimWelcome(pool, mutationType, before, after, entityType = 'Project') {
  if (!after?.company_id) return;
  return insuranceClaimWelcome.sendInsuranceClaimWelcomeEmail({
    pool, companyId: after.company_id, projectId: after.id,
    mutationType, previousProject: before, previousCustomer: before, entityType,
    executeEmail: ({ action, entityData, companyId, entityType, entityId }) =>
      executeWorkflowAction(pool, action, entityData, companyId, entityType, entityId),
  }).then(result => {
    if (result.reason && result.skipped !== true) console.warn('[Insurance welcome]', result.reason);
  }).catch(error => console.warn('[Insurance welcome]', error.message));
}

async function sendViaResend({ to, subject, html, from }) {
  if (nodeRequire('./lib/emailTransport.cjs').activeProvider() === 'none') { console.warn('[Email] No email provider configured — skipping'); return; }
  const fromAddr = from || process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';
  const toArr = Array.isArray(to) ? to : [to];
  await nodeRequire('./lib/emailTransport.cjs').sendPlatformEmail({ to: toArr, from: fromAddr, subject, html });
}

async function sendNewCompanyEmails({ email, displayName, companyName, companyId }) {
  const adminEmail = process.env.ADMIN_EMAIL || 'io.companysync@gmail.com';
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  // Welcome email to new user
  await sendViaResend({
    to: email,
    subject: `Welcome to CompanySync — Your free trial is ready!`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
        <div style="background:#1d4ed8;padding:28px 32px;border-radius:8px 8px 0 0;">
          <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to CompanySync!</h1>
        </div>
        <div style="background:#fff;padding:28px 32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:16px;">Hi ${displayName},</p>
          <p>Your <strong>free trial account</strong> is ready. Here's what you can do right now:</p>
          <ul>
            <li>Add your first customer or lead</li>
            <li>Create an AI-powered estimate in seconds</li>
            <li>Set up your workflow automations</li>
            <li>Track jobs, invoices, and follow-ups in one place</li>
          </ul>
          <p>
            <a href="https://getcompanysync.com" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
              Log In to CompanySync →
            </a>
          </p>
          <p style="margin-top:24px;color:#6b7280;font-size:14px;">
            Questions? Reply to this email or reach us at <a href="mailto:io.companysync@gmail.com">io.companysync@gmail.com</a>.
          </p>
          <p style="color:#6b7280;font-size:14px;">— The CompanySync Team</p>
        </div>
      </div>
    `
  });

  // Admin notification to Kevin
  await sendViaResend({
    to: adminEmail,
    subject: `🆕 New Trial Signup — ${companyName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
        <div style="background:#059669;padding:24px 28px;border-radius:8px 8px 0 0;">
          <h2 style="color:#fff;margin:0;">New Trial Account Created</h2>
        </div>
        <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Company Name</td><td style="padding:8px 0;font-weight:bold;">${companyName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;">${email}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Company ID</td><td style="padding:8px 0;font-family:monospace;font-size:13px;">${companyId}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Signed Up</td><td style="padding:8px 0;">${now}</td></tr>
          </table>
          <p style="margin-top:20px;">
            <a href="https://getcompanysync.com" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
              View in Master Admin →
            </a>
          </p>
        </div>
      </div>
    `
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url) {
  const params = {};
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return params;
  const qs = url.substring(qIdx + 1);
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return params;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, message, status = 500) {
  sendJson(res, { error: message }, status);
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
// These rows are written only by trusted server processes. Exposing them
// through generic CRUD would let a tenant erase rate limits or delivery audit
// evidence that protects the shared provider account.
const INTERNAL_ENTITY_TYPES = new Set(['EmailRateLimit', 'EmailDeliveryEvent', 'EmailProviderStatus', 'InsuranceClaimWelcomeEmailSend']);

function isInternalEntityType(entityType) {
  return INTERNAL_ENTITY_TYPES.has(entityType);
}

const SDK_TO_TABLE = {
  Company: 'companies',
  StaffProfile: 'staff_profiles',
  Lead: 'leads',
  Customer: 'customers',
  Estimate: 'estimates',
  Invoice: 'invoices',
  Payment: 'payments',
  Project: 'projects',
  Task: 'tasks',
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

const GENERIC_DIRECT_COLUMNS = new Set(['id', 'company_id', 'entity_type', 'created_date', 'updated_date']);

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

// Parse operator values that arrive as JSON strings from URL params (e.g., '{"$in":[...]}')
function parseOperatorVal(val) {
  if (typeof val === 'string' && val.startsWith('{')) {
    try { return JSON.parse(val); } catch (_) {}
  }
  return val;
}

function buildFilterWhere(filters, startIdx = 1) {
  const clauses = [];
  const values = [];
  let idx = startIdx;

  for (const [key, rawVal] of Object.entries(filters)) {
    if (key === '_sort' || key === '_limit' || key === '_offset' || key === 'company_id') continue;
    const val = parseOperatorVal(rawVal);

    const isDirect = GENERIC_DIRECT_COLUMNS.has(key);
    const colRef = isDirect ? `"${key}"` : `data->>'${key}'`;

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (val.$ne !== undefined) {
        if (val.$ne === null) {
          clauses.push(`${colRef} IS NOT NULL`);
        } else {
          clauses.push(`${colRef} != $${idx}`);
          values.push(String(val.$ne));
          idx++;
        }
      }
      if (val.$in && Array.isArray(val.$in)) {
        const placeholders = val.$in.map((_, i) => `$${idx + i}`);
        clauses.push(`${colRef} IN (${placeholders.join(',')})`);
        values.push(...val.$in.map(String));
        idx += val.$in.length;
      }
      if (val.$gt !== undefined) {
        if (isDirect) {
          clauses.push(`"${key}" > $${idx}`);
        } else {
          clauses.push(`(data->>'${key}')::numeric > $${idx}`);
        }
        values.push(val.$gt);
        idx++;
      }
      if (val.$gte !== undefined) {
        if (isDirect) {
          clauses.push(`"${key}" >= $${idx}`);
        } else {
          clauses.push(`(data->>'${key}')::numeric >= $${idx}`);
        }
        values.push(val.$gte);
        idx++;
      }
      if (val.$lt !== undefined) {
        if (isDirect) {
          clauses.push(`"${key}" < $${idx}`);
        } else {
          clauses.push(`(data->>'${key}')::numeric < $${idx}`);
        }
        values.push(val.$lt);
        idx++;
      }
      if (val.$lte !== undefined) {
        if (isDirect) {
          clauses.push(`"${key}" <= $${idx}`);
        } else {
          clauses.push(`(data->>'${key}')::numeric <= $${idx}`);
        }
        values.push(val.$lte);
        idx++;
      }
      if (val.$contains !== undefined) {
        clauses.push(`${colRef} ILIKE $${idx}`);
        values.push(`%${val.$contains}%`);
        idx++;
      }
    } else {
      if (val === null) {
        clauses.push(`(${colRef} IS NULL OR ${colRef} = '')`);
      } else {
        clauses.push(`${colRef} = $${idx}`);
        values.push(String(val));
        idx++;
      }
    }
  }

  return { clauses, values, nextIdx: idx };
}

function buildDedicatedFilterWhere(filters, startIdx = 1, tableColumns = null) {
  const clauses = [];
  const values = [];
  let idx = startIdx;

  for (const [key, rawVal] of Object.entries(filters)) {
    if (key === '_sort' || key === '_limit' || key === '_offset' || key === 'company_id') continue;
    const val = parseOperatorVal(rawVal);

    // Remap created_date → created_at for dedicated tables. Dedicated tables
    // store the timestamp in created_at; created_date is the SDK-level alias
    // returned in query results. Without this remap the filter falls back to
    // data->>'created_date' (JSONB), which is always empty for these tables.
    const normalizedKey = (key === 'created_date' && tableColumns && tableColumns.has('created_at')) ? 'created_at' : key;
    const isDirectCol = !tableColumns || tableColumns.has(normalizedKey);
    const colRef = isDirectCol ? `"${normalizedKey}"` : `data->>'${key}'`;

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (val.$ne !== undefined) {
        if (val.$ne === null) {
          clauses.push(`${colRef} IS NOT NULL`);
        } else {
          clauses.push(`${colRef} != $${idx}`);
          values.push(isDirectCol ? val.$ne : String(val.$ne));
          idx++;
        }
      }
      if (val.$in && Array.isArray(val.$in)) {
        const placeholders = val.$in.map((_, i) => `$${idx + i}`);
        clauses.push(`${colRef} IN (${placeholders.join(',')})`);
        values.push(...val.$in.map(v => isDirectCol ? v : String(v)));
        idx += val.$in.length;
      }
      if (val.$contains !== undefined) {
        clauses.push(`${colRef} ILIKE $${idx}`);
        values.push(`%${val.$contains}%`);
        idx++;
      }
      if (val.$gt !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${normalizedKey}" > $${idx}`);
          values.push(val.$gt);
        } else {
          clauses.push(`(data->>'${key}')::numeric > $${idx}`);
          values.push(Number(val.$gt));
        }
        idx++;
      }
      if (val.$gte !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${normalizedKey}" >= $${idx}`);
          values.push(val.$gte);
        } else {
          clauses.push(`(data->>'${key}')::numeric >= $${idx}`);
          values.push(Number(val.$gte));
        }
        idx++;
      }
      if (val.$lt !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${normalizedKey}" < $${idx}`);
          values.push(val.$lt);
        } else {
          clauses.push(`(data->>'${key}')::numeric < $${idx}`);
          values.push(Number(val.$lt));
        }
        idx++;
      }
      if (val.$lte !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${normalizedKey}" <= $${idx}`);
          values.push(val.$lte);
        } else {
          clauses.push(`(data->>'${key}')::numeric <= $${idx}`);
          values.push(Number(val.$lte));
        }
        idx++;
      }
    } else {
      if (val === null) {
        clauses.push(`(${colRef} IS NULL OR ${colRef} = '')`);
      } else {
        clauses.push(`${colRef} = $${idx}`);
        values.push(isDirectCol ? val : String(val));
        idx++;
      }
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

async function genericFilter(pool, entityType, filters = {}, sort = '-created_date', limit = 1000) {
  let companyId = filters.company_id;
  // parseQuery returns all values as strings; JSON-decode operator objects like {"$in":[...]}
  if (typeof companyId === 'string' && companyId.startsWith('{')) {
    try { companyId = JSON.parse(companyId); } catch (_) {}
  }
  const { column: sortCol, direction: sortDir } = parseSortParam(sort);

  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(pool, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));
    const filterCopy = { ...filters };
    delete filterCopy.company_id;

    const whereParts = [];
    const values = [];
    let idx = 1;

    if (companyId && tableInfo.companyField !== 'id') {
      const isOp = companyId && typeof companyId === 'object' && !Array.isArray(companyId);
      if (isOp && companyId.$in && Array.isArray(companyId.$in)) {
        const placeholders = companyId.$in.map((_, i) => `${tableInfo.companyField} = $${idx + i}`);
        whereParts.push(...placeholders);
        values.push(...companyId.$in);
        idx += companyId.$in.length;
      } else {
        whereParts.push(`${tableInfo.companyField} = $${idx}`);
        values.push(isOp ? Object.values(companyId)[0] : companyId);
        idx++;
      }
    } else if (companyId && tableInfo.companyField === 'id') {
      const isOp = companyId && typeof companyId === 'object' && !Array.isArray(companyId);
      if (isOp && companyId.$in && Array.isArray(companyId.$in)) {
        const placeholders = companyId.$in.map((_, i) => `id = $${idx + i}`);
        whereParts.push(...placeholders);
        values.push(...companyId.$in);
        idx += companyId.$in.length;
      } else {
        whereParts.push(`id = $${idx}`);
        values.push(isOp ? Object.values(companyId)[0] : companyId);
        idx++;
      }
    }

    const { clauses, values: filterVals } = buildDedicatedFilterWhere(filterCopy, idx, tableColumns);
    whereParts.push(...clauses);
    values.push(...filterVals);

    const whereStr = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    let orderCol = sortCol;
    if (sortCol === 'created_date') orderCol = 'created_at';
    if (sortCol === 'updated_date') orderCol = 'updated_at';
    if (!tableColumns.has(orderCol) && orderCol !== 'created_at' && orderCol !== 'updated_at') {
      orderCol = `data->>'${sortCol}'`;
    } else {
      orderCol = `"${orderCol}"`;
    }

    const sql = `SELECT * FROM ${tableInfo.table} ${whereStr} ORDER BY ${orderCol} ${sortDir} NULLS LAST LIMIT ${parseInt(limit) || 1000}`;
    const result = await pool.query(sql, values);

    return result.rows.map(row => {
      const merged = { ...row };
      if (row.data && typeof row.data === 'object') {
        for (const [k, v] of Object.entries(row.data)) {
          if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
            merged[k] = v;
          }
        }
      }
      if (row.created_at) merged.created_date = row.created_at;
      if (row.updated_at) merged.updated_date = row.updated_at;
      if (tableInfo.table === 'staff_profiles') {
        if (!merged.full_name && merged.name) merged.full_name = merged.name;
        if (!merged.name && merged.full_name) merged.name = merged.full_name;
      }
      return merged;
    });
  }

  const whereParts = [];
  const values = [];
  let idx = 1;

  whereParts.push(`entity_type = $${idx}`);
  values.push(entityType);
  idx++;

  if (companyId) {
    const isOp = typeof companyId === 'object' && !Array.isArray(companyId);
    if (isOp && companyId.$in && Array.isArray(companyId.$in)) {
      const placeholders = companyId.$in.map((_, i) => `$${idx + i}`);
      whereParts.push(`company_id IN (${placeholders.join(',')})`);
      values.push(...companyId.$in);
      idx += companyId.$in.length;
    } else {
      whereParts.push(`company_id = $${idx}`);
      values.push(isOp ? Object.values(companyId)[0] : companyId);
      idx++;
    }
  }

  const filterCopy = { ...filters };
  delete filterCopy.company_id;

  const { clauses, values: filterVals } = buildFilterWhere(filterCopy, idx);
  whereParts.push(...clauses);
  values.push(...filterVals);

  const whereStr = `WHERE ${whereParts.join(' AND ')}`;

  let orderExpr;
  if (sortCol === 'created_date') {
    orderExpr = `created_date ${sortDir}`;
  } else if (sortCol === 'updated_date') {
    orderExpr = `updated_date ${sortDir}`;
  } else {
    orderExpr = `data->>'${sortCol}' ${sortDir}`;
  }

  const sql = `SELECT * FROM generic_entities ${whereStr} ORDER BY ${orderExpr} NULLS LAST LIMIT ${parseInt(limit) || 1000}`;
  const result = await pool.query(sql, values);

  return result.rows.map(row => ({
    id: row.id,
    company_id: row.company_id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    ...(row.data || {}),
  }));
}

async function genericList(pool, entityType, sort = '-created_date', limit = 1000) {
  return genericFilter(pool, entityType, {}, sort, limit);
}

async function genericGet(pool, entityType, id) {
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const result = await pool.query(`SELECT * FROM ${tableInfo.table} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const merged = { ...row };
    if (row.data && typeof row.data === 'object') {
      for (const [k, v] of Object.entries(row.data)) {
        if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
          merged[k] = v;
        }
      }
    }
    if (row.created_at) merged.created_date = row.created_at;
    if (row.updated_at) merged.updated_date = row.updated_at;
    if (tableInfo.table === 'staff_profiles') {
      if (!merged.full_name && merged.name) merged.full_name = merged.name;
      if (!merged.name && merged.full_name) merged.name = merged.full_name;
    }
    return merged;
  }

  const result = await pool.query(
    'SELECT * FROM generic_entities WHERE id = $1 AND entity_type = $2',
    [id, entityType]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    company_id: row.company_id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    ...(row.data || {}),
  };
}

function sanitizeValueForColumn(key, val, columnDataTypes) {
  const colType = columnDataTypes ? columnDataTypes[key] : null;
  const isTimestampCol = colType && (colType.includes('timestamp') || colType.includes('date'));
  const looksLikeTimestamp = !colType && (key.endsWith('_date') || key.endsWith('_at') || key === 'due_date' || key === 'start_date' || key === 'end_date' || key === 'start_time' || key === 'end_time' || key === 'expires_at' || key === 'payment_date');

  if ((isTimestampCol || looksLikeTimestamp) && (val === '' || val === undefined)) {
    return null;
  }

  const isNumericCol = colType && (colType.includes('numeric') || colType.includes('integer') || colType.includes('decimal'));
  if (isNumericCol && (val === '' || val === undefined)) {
    return null;
  }
  if (isNumericCol && Array.isArray(val)) {
    // Array sent to a numeric column — take first numeric element
    const first = val.find(v => v !== null && v !== undefined && v !== '');
    return first !== undefined ? parseInt(first, 10) : null;
  }

  if (typeof val === 'boolean') {
    return val;
  }

  return val;
}

async function getColumnDataTypes(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
    [tableName]
  );
  const types = {};
  for (const row of result.rows) {
    types[row.column_name] = row.data_type;
  }
  return types;
}

const DUPLICATE_CHECK_RULES = {
  Company: {
    genericField: 'company_name',
    scope: 'global',
    message: (name) => `A company named "${name}" already exists`,
  },
  Lead: {
    genericField: 'email',
    scope: 'company',
    message: (email) => `A lead with email "${email}" already exists in this company`,
  },
  Customer: {
    genericField: 'email',
    scope: 'company',
    message: (email) => `A customer with email "${email}" already exists in this company`,
  },
  StaffProfile: {
    dedicatedField: 'user_email',
    altField: 'email',
    scope: 'company',
    message: (email) => `A staff profile for "${email}" already exists in this company`,
  },
};

async function checkDuplicateBeforeCreate(pool, entityType, data) {
  const rule = DUPLICATE_CHECK_RULES[entityType];
  if (!rule) return null;

  const companyId = data.company_id || null;
  let valueToCheck = null;

  if (rule.dedicatedField) {
    valueToCheck = data[rule.dedicatedField] || data[rule.altField] || null;
  } else if (rule.genericField) {
    valueToCheck = data[rule.genericField] || null;
  }

  if (!valueToCheck) return null;
  valueToCheck = String(valueToCheck).toLowerCase().trim();
  if (!valueToCheck) return null;

  try {
    const field = rule.dedicatedField || rule.genericField;

    if (isDedicatedTable(entityType)) {
      const tableInfo = DEDICATED_TABLES[entityType];
      let sql, params;
      if (rule.scope === 'company' && companyId) {
        sql = `SELECT id FROM ${tableInfo.table} WHERE LOWER(COALESCE(${field}, '')) = $1 AND company_id = $2 LIMIT 1`;
        params = [valueToCheck, companyId];
      } else {
        sql = `SELECT id FROM ${tableInfo.table} WHERE LOWER(COALESCE(${field}, '')) = $1 LIMIT 1`;
        params = [valueToCheck];
      }
      const result = await pool.query(sql, params);
      if (result.rows.length > 0) {
        return { message: rule.message(valueToCheck), existingId: result.rows[0].id };
      }
    } else {
      let sql, params;
      if (rule.scope === 'company' && companyId) {
        sql = `SELECT id FROM generic_entities WHERE entity_type = $1 AND company_id = $2 AND LOWER(data->>'${field}') = $3 LIMIT 1`;
        params = [entityType, companyId, valueToCheck];
      } else {
        sql = `SELECT id FROM generic_entities WHERE entity_type = $1 AND LOWER(data->>'${field}') = $2 LIMIT 1`;
        params = [entityType, valueToCheck];
      }
      const result = await pool.query(sql, params);
      if (result.rows.length > 0) {
        return { message: rule.message(valueToCheck), existingId: result.rows[0].id };
      }
    }
  } catch (err) {
    console.error(`[DuplicateCheck] Error checking ${entityType}:`, err.message);
  }

  return null;
}

/**
 * Normalize and validate an E.164 phone number.
 * Strips all non-digit characters except a leading +, then enforces:
 *   - starts with +
 *   - first digit after + is 1-9 (valid country code range)
 *   - total of 7-15 digits following the +
 * Returns { normalized } on success or { error } on failure.
 * An empty/falsy value is valid (field is optional).
 */
function validateAndNormalizeE164(phone) {
  if (!phone) return { normalized: phone };
  const raw = String(phone);
  // Strip everything that isn't a digit or a leading +
  const cleaned = (raw.startsWith('+') ? '+' : '') + raw.replace(/[^\d]/g, '');
  const digits = cleaned.slice(1); // everything after the leading +
  if (!cleaned.startsWith('+') || !/^[1-9]\d{6,14}$/.test(digits)) {
    return { error: 'Invalid approval_alert_phone format. Use E.164 (e.g. +15551234567): must start with + and country code followed by 7–15 digits.' };
  }
  return { normalized: cleaned };
}

// ── Double-booking guard ────────────────────────────────────────────────────
// Called before any CalendarEvent INSERT or UPDATE.
// Returns null (safe to proceed) or { conflict, type, message, existing }.
// Mirror this function verbatim in db/prod-db.cjs.
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
// ───────────────────────────────────────────────────────────────────────────

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

// countNeeded = how many new records are being created (1 for single, n for bulk).
async function checkEntityCreationLimit(pool, entityType, companyId, isSuperAdmin, countNeeded = 1) {
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
    const n = countNeeded || 1; // batch size guard

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

async function genericCreate(pool, entityType, data) {
  const id = data.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const companyId = data.company_id || null;

  if (entityType === 'staff_profiles') {
    const emailToCheck = (data.user_email || data.email || '').toLowerCase().trim();
    if (emailToCheck && companyId) {
      const existing = await pool.query(
        'SELECT * FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) = $1 AND company_id = $2 LIMIT 1',
        [emailToCheck, companyId]
      );
      if (existing.rows.length > 0) {
        console.log(`[Entity Create] Staff profile already exists for ${emailToCheck} in company ${companyId}, returning existing`);
        const row = existing.rows[0];
        const merged = { ...row };
        if (row.data && typeof row.data === 'object') {
          for (const [k, v] of Object.entries(row.data)) {
            if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v;
          }
        }
        if (row.created_at) merged.created_date = row.created_at;
        if (row.updated_at) merged.updated_date = row.updated_at;
        return merged;
      }
    }
    if (data.email && !data.user_email) {
      data.user_email = data.email;
    }
  }

  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(pool, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));

    const idColType = columnDataTypes['id'] || '';
    const isAutoIncrementId = idColType === 'integer' || idColType === 'bigint';
    
    // Check if we're trying to insert a string into an integer ID column
    const idValue = data.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const finalId = (isAutoIncrementId && typeof idValue === 'string' && idValue.startsWith('local_')) ? undefined : idValue;

    const directCols = (isAutoIncrementId && finalId === undefined) ? [] : ['id'];
    const directVals = (isAutoIncrementId && finalId === undefined) ? [] : [finalId];
    const extraData = {};
    let idx = (isAutoIncrementId && finalId === undefined) ? 1 : 2;

    for (const [key, val] of Object.entries(data)) {
      if (key === 'id') continue;
      if (tableColumns.has(key)) {
        directCols.push(key);
        const sanitized = sanitizeValueForColumn(key, val, columnDataTypes);
        if (sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized) && key !== 'data') {
          directVals.push(JSON.stringify(sanitized));
        } else if (Array.isArray(sanitized)) {
          directVals.push(JSON.stringify(sanitized));
        } else {
          directVals.push(sanitized);
        }
        idx++;
      } else {
        extraData[key] = val;
      }
    }

    if (Object.keys(extraData).length > 0 && tableColumns.has('data')) {
      const existingDataIdx = directCols.indexOf('data');
      if (existingDataIdx !== -1) {
        // 'data' column was already added from the body — merge extraData into it
        const existing = typeof directVals[existingDataIdx] === 'string'
          ? JSON.parse(directVals[existingDataIdx])
          : (directVals[existingDataIdx] || {});
        directVals[existingDataIdx] = JSON.stringify({ ...existing, ...extraData });
      } else {
        directCols.push('data');
        directVals.push(JSON.stringify(extraData));
        idx++;
      }
    }

    if (!directCols.includes('created_at') && tableColumns.has('created_at')) {
      directCols.push('created_at');
      directVals.push(new Date());
      idx++;
    }
    if (!directCols.includes('updated_at') && tableColumns.has('updated_at')) {
      directCols.push('updated_at');
      directVals.push(new Date());
      idx++;
    }

    const placeholders = directCols.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${tableInfo.table} (${directCols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders}) RETURNING *`;

    try {
      const insertResult = await pool.query(sql, directVals);
      const row = insertResult.rows[0];
      const merged = { ...row };
      if (row.data && typeof row.data === 'object') {
        for (const [k, v] of Object.entries(row.data)) {
          if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
            merged[k] = v;
          }
        }
      }
      if (row.created_at) merged.created_date = row.created_at;
      if (row.updated_at) merged.updated_date = row.updated_at;
      return merged;
    } catch (err) {
      console.error(`[Entity Create] Error inserting into ${tableInfo.table}:`, err.message);
      throw err;
    }
  }

  const entityData = { ...data };
  delete entityData.id;
  delete entityData.company_id;

  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data = $4, updated_date = NOW()`,
    [id, entityType, companyId, JSON.stringify(entityData)]
  );

  return { id, company_id: companyId, ...entityData, created_date: new Date(), updated_date: new Date() };
}

async function genericUpdate(pool, entityType, id, data) {
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(pool, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));

    const updates = [];
    const values = [];
    const extraData = {};
    const usedColumns = new Set();
    let idx = 1;

    let explicitData = null;
    for (const [key, val] of Object.entries(data)) {
      if (key === 'id' || key === 'created_date' || key === 'created_at') continue;
      if (key === 'data') {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          explicitData = val;
        }
        continue;
      }
      if (tableColumns.has(key)) {
        if (usedColumns.has(key)) continue;
        usedColumns.add(key);
        const sanitized = sanitizeValueForColumn(key, val, columnDataTypes);
        updates.push(`"${key}" = $${idx}`);
        if (sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
          values.push(JSON.stringify(sanitized));
        } else if (Array.isArray(sanitized)) {
          values.push(JSON.stringify(sanitized));
        } else {
          values.push(sanitized);
        }
        idx++;
      } else {
        extraData[key] = val;
      }
    }

    const mergedJsonb = { ...extraData, ...(explicitData || {}) };
    if (Object.keys(mergedJsonb).length > 0 && tableColumns.has('data') && !usedColumns.has('data')) {
      usedColumns.add('data');
      updates.push(`data = COALESCE(data, '{}')::jsonb || $${idx}::jsonb`);
      values.push(JSON.stringify(mergedJsonb));
      idx++;
    }

    if (tableColumns.has('updated_at') && !usedColumns.has('updated_at')) {
      usedColumns.add('updated_at');
      updates.push(`updated_at = $${idx}`);
      values.push(new Date());
      idx++;
    }

    if (updates.length === 0) {
      return genericGet(pool, entityType, id);
    }

    values.push(id);
    const sql = `UPDATE ${tableInfo.table} SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;

    try {
      const updateResult = await pool.query(sql, values);
      if (updateResult.rows.length === 0) throw new Error('Record not found');
      const row = updateResult.rows[0];
      const merged = { ...row };
      if (row.data && typeof row.data === 'object') {
        for (const [k, v] of Object.entries(row.data)) {
          if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
            merged[k] = v;
          }
        }
      }
      if (row.created_at) merged.created_date = row.created_at;
      if (row.updated_at) merged.updated_date = row.updated_at;
      return merged;
    } catch (err) {
      console.error(`[Entity Update] Error updating ${tableInfo.table}:`, err.message);
      throw err;
    }
  }

  const existing = await pool.query(
    'SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2',
    [id, entityType]
  );

  const existingData = existing.rows.length > 0 ? (existing.rows[0].data || {}) : {};
  const mergedData = { ...existingData, ...data };
  delete mergedData.id;
  delete mergedData.company_id;

  const companyId = data.company_id || (existing.rows[0] ? null : null);

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2 AND entity_type = $3`,
      [JSON.stringify(mergedData), id, entityType]
    );
  } else {
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [id, entityType, companyId, JSON.stringify(mergedData)]
    );
  }

  return { id, company_id: companyId, ...mergedData, updated_date: new Date() };
}

async function genericDelete(pool, entityType, id) {
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const result = await pool.query(`DELETE FROM ${tableInfo.table} WHERE id = $1 RETURNING id`, [id]);
    return result.rows.length > 0;
  }

  const result = await pool.query(
    'DELETE FROM generic_entities WHERE id = $1 AND entity_type = $2 RETURNING id',
    [id, entityType]
  );
  return result.rows.length > 0;
}

async function genericBulkCreate(pool, entityType, items) {
  const results = [];
  for (const item of items) {
    const dupCheck = await checkDuplicateBeforeCreate(pool, entityType, item);
    if (dupCheck) {
      results.push({ skipped: true, duplicate: true, message: dupCheck.message, existing_id: dupCheck.existingId });
      continue;
    }
    const created = await genericCreate(pool, entityType, item);
    results.push(created);
  }
  return results;
}

let _backfillSkipLogged = false;
async function backfillOrphanedRecords(pool, _companyId) {
  const tables = ['leads', 'customers', 'estimates', 'invoices', 'payments', 'projects', 'tasks', 'calendar_events', 'communications', 'generic_entities'];
  let totalOrphans = 0;
  for (const table of tables) {
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id IS NULL`
      );
      const count = result.rows[0]?.n || 0;
      if (count > 0) {
        console.warn(`[Backfill] ${count} ${table} rows have no company_id; left untouched`);
        totalOrphans += count;
      }
    } catch (err) {
      console.error(`[Backfill] Error counting ${table}:`, err.message);
    }
  }
  if (totalOrphans > 0 && !_backfillSkipLogged) {
    console.warn(`[Backfill] ${totalOrphans} company-less rows left untouched`);
    _backfillSkipLogged = true;
  }
}

function getDefaultTemplates(companyId, companyName) {
  const isYICN = companyId === 'yicn_roofing_legacy';
  const co = companyName || 'Your Company';

  const sfAgeLife = isYICN ? {
    format_name: 'State Farm Standard (Age/Life)',
    category: 'insurance',
    insurance_company: 'State Farm',
    description: '🏦 State Farm AGE/LIFE format - Shows depreciation as Age/Life years (15/30 = 50% off). Auto-calculates ACV from RCV based on material lifespan. Includes O&P, claim details, and adjuster fields.',
    columns: 9,
    column_headers: ['Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'RCV', 'Age/Life', 'Depr %', 'ACV'],
    show_rcv_acv: true,
    show_depreciation: true,
    show_age_life: true,
    age_life_presets: { shingles: { life_years: 30, default_age: 15 }, underlayment: { life_years: 20, default_age: 10 }, felt: { life_years: 20, default_age: 10 }, flashing: { life_years: 20, default_age: 10 }, ice_water_shield: { life_years: 20, default_age: 0 } },
    rcv_label: 'RCV',
    acv_label: 'ACV',
    show_overhead_profit: true,
    overhead_profit_rate: 10,
    show_claim_number: true,
    show_insurance_company: true,
    show_policy_number: true,
    show_deductible: true,
    show_adjuster: false,
    header_text: 'YICN Roofing State Farm Preferred Contractor 216-999-6222',
    footer_text: 'All work meets State Farm guidelines. Questions? Contact your adjuster.',
    page_size: 'letter',
    font_size: 'medium',
    color_scheme: 'red',
    is_active: true,
  } : {
    format_name: 'State Farm Standard (Age/Life)',
    category: 'insurance',
    insurance_company: 'State Farm',
    description: 'State Farm format with age/life depreciation columns',
    columns: 9,
    column_headers: ['Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'RCV', 'Age/Life', 'Depr %', 'ACV'],
    show_rcv_acv: true,
    show_depreciation: true,
    show_age_life: true,
    age_life_presets: { shingles: { life_years: 30, default_age: 15 }, underlayment: { life_years: 20, default_age: 10 }, felt: { life_years: 20, default_age: 10 }, flashing: { life_years: 20, default_age: 10 } },
    rcv_label: 'RCV',
    acv_label: 'ACV',
    show_overhead_profit: true,
    overhead_profit_rate: 10,
    show_claim_number: true,
    show_insurance_company: true,
    show_policy_number: true,
    show_deductible: true,
    show_adjuster: false,
    header_text: `${co} - State Farm Preferred Contractor`,
    footer_text: 'All work meets State Farm guidelines. Questions? Contact your adjuster.',
    page_size: 'letter',
    font_size: 'medium',
    color_scheme: 'red',
    is_active: true,
  };

  const safeco = isYICN ? {
    format_name: 'Safeco Standard (Symbility)',
    category: 'insurance',
    insurance_company: 'Safeco',
    description: '🛡️ Safeco/Liberty Mutual/Erie format - Full RCV/ACV with detailed depreciation breakdown, O&P calculations, tax breakdown, and coverage summary. Used by Symbility estimators.',
    columns: 8,
    column_headers: ['Description', 'Qty', 'Unit', 'Tax', 'Total'],
    show_rcv_acv: true,
    show_depreciation: false,
    show_age_life: false,
    rcv_label: 'Replacement Cost',
    acv_label: 'Actual Cash Value',
    show_overhead_profit: true,
    overhead_profit_rate: 10,
    show_claim_number: true,
    show_insurance_company: true,
    show_policy_number: true,
    show_deductible: true,
    show_adjuster: false,
    header_text: 'YICN Roofing Safeco/Liberty Mutual/Erie Approved 216-999-6222',
    footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO THE STRUCTURE.',
    page_size: 'letter',
    font_size: 'medium',
    color_scheme: 'blue',
    is_active: true,
  } : {
    format_name: 'Safeco Standard (Symbility)',
    category: 'insurance',
    insurance_company: 'Safeco',
    description: 'Safeco/Liberty Mutual/Erie format - Full RCV/ACV with detailed depreciation breakdown and O&P calculations.',
    columns: 8,
    column_headers: ['Description', 'Qty', 'Unit', 'Tax', 'Total'],
    show_rcv_acv: true,
    show_depreciation: false,
    show_age_life: false,
    rcv_label: 'Replacement Cost',
    acv_label: 'Actual Cash Value',
    show_overhead_profit: true,
    overhead_profit_rate: 10,
    show_claim_number: true,
    show_insurance_company: true,
    show_policy_number: true,
    show_deductible: true,
    show_adjuster: false,
    header_text: `${co} - Safeco/Liberty Mutual/Erie Approved`,
    footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO THE STRUCTURE.',
    page_size: 'letter',
    font_size: 'medium',
    color_scheme: 'blue',
    is_active: true,
  };

  const contractor = isYICN ? {
    format_name: 'Contractor Standard (CompanySync)',
    category: 'contractor',
    insurance_company: null,
    description: '🔨 Direct-to-customer contractor format - Simple Item/Qty/Rate/Amount layout. No insurance calculations or depreciation. Clean, professional look for retail jobs.',
    columns: 6,
    column_headers: ['Item', 'Qty', 'Rate', 'Amount'],
    show_rcv_acv: false,
    show_depreciation: false,
    show_age_life: false,
    rcv_label: 'RCV',
    acv_label: 'ACV',
    show_overhead_profit: false,
    overhead_profit_rate: 0,
    show_claim_number: true,
    show_insurance_company: true,
    show_policy_number: true,
    show_deductible: true,
    show_adjuster: false,
    header_text: 'YICN Roofing 216-999-6222 | kevinstone@yicnteam.com 675 Alpha Dr, Highland Heights, OH 44143',
    footer_text: 'A 5-year workmanship warranty backs all work. If for any reason, the property owner or contractor selected have questions concerning our estimate, they should contact your claim representative directly.',
    page_size: 'letter',
    font_size: 'medium',
    color_scheme: 'green',
    is_active: true,
  } : {
    format_name: 'Contractor Standard (CompanySync)',
    category: 'contractor',
    insurance_company: null,
    description: 'Direct-to-customer contractor format - Simple Item/Qty/Rate/Amount layout. No insurance calculations or depreciation.',
    columns: 4,
    column_headers: ['Item', 'Qty', 'Rate', 'Amount'],
    show_rcv_acv: false,
    show_depreciation: false,
    show_age_life: false,
    rcv_label: 'RCV',
    acv_label: 'ACV',
    show_overhead_profit: false,
    overhead_profit_rate: 0,
    show_claim_number: false,
    show_insurance_company: false,
    show_policy_number: false,
    show_deductible: false,
    show_adjuster: false,
    header_text: `${co}`,
    footer_text: 'A 5-year workmanship warranty backs all work. Price valid for 30 days from estimate date.',
    page_size: 'letter',
    font_size: 'medium',
    color_scheme: 'green',
    is_active: true,
  };

  return [
    sfAgeLife,
    safeco,
    contractor,
    {
      format_name: 'State Farm Standard (Xactimate)',
      category: 'insurance',
      insurance_company: 'State Farm',
      description: 'Standard State Farm insurance estimate format compatible with Xactimate pricing. Includes RCV/ACV, tax breakdown, and trade summary.',
      columns: 7,
      column_headers: ['Description', 'Quantity', 'Unit Price', 'Tax', 'RCV', 'ACV'],
      show_rcv_acv: false,
      show_depreciation: true,
      show_age_life: false,
      rcv_label: 'RCV',
      acv_label: 'ACV',
      show_overhead_profit: true,
      overhead_profit_rate: 10,
      show_claim_number: true,
      show_insurance_company: true,
      show_policy_number: true,
      show_deductible: true,
      show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing State Farm Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.',
      page_size: 'letter',
      font_size: 'medium',
      color_scheme: 'blue',
      is_active: true,
    },
    {
      format_name: 'State Farm Standard (Copy)',
      category: 'insurance',
      insurance_company: 'State Farm',
      description: 'Standard State Farm estimate format with RCV/ACV calculations.',
      columns: 7,
      column_headers: ['Code', 'Description', 'Quantity', 'Unit', 'Unit Price', 'Tax', 'RCV'],
      show_rcv_acv: false,
      show_depreciation: true,
      show_age_life: false,
      rcv_label: 'RCV',
      acv_label: 'ACV',
      show_overhead_profit: true,
      overhead_profit_rate: 10,
      show_claim_number: true,
      show_insurance_company: true,
      show_policy_number: true,
      show_deductible: true,
      show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing State Farm Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'This estimate is priced based on estimated market pricing for the cost of materials, labor, and other factors at the time of the loss.',
      page_size: 'letter',
      font_size: 'medium',
      color_scheme: 'blue',
      is_active: true,
    },
    {
      format_name: 'Safeco Standard (Liberty Mutual)',
      category: 'insurance',
      insurance_company: 'Safeco / Liberty Mutual',
      description: 'Standard Safeco format used by Liberty Mutual and Erie. Full RCV/ACV calculations with detailed depreciation breakdown, O&P columns, and coverage summary.',
      columns: 10,
      column_headers: ['Description', 'Quantity', 'Unit Price', 'Total O&P', 'Total Taxes', 'RC', 'Depreciation', 'ACV'],
      show_rcv_acv: true,
      show_depreciation: true,
      show_age_life: false,
      rcv_label: 'RCV',
      acv_label: 'ACV',
      show_overhead_profit: true,
      overhead_profit_rate: 10,
      show_claim_number: true,
      show_insurance_company: true,
      show_policy_number: true,
      show_deductible: true,
      show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing Safeco/Liberty Mutual/Erie Approved 216-999-6222' : `${co} - Safeco/Liberty Mutual/Erie Approved`,
      footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO YOUR INSURED PROPERTY AND MAY BE REVISED AS WE CONTINUE TO EVALUATE YOUR CLAIM.',
      page_size: 'letter',
      font_size: 'small',
      color_scheme: 'blue',
      is_active: true,
    },
    {
      format_name: 'Allstate Standard',
      category: 'insurance',
      insurance_company: 'Allstate',
      description: 'Allstate insurance format similar to Xactimate with detailed line items and RCV/ACV breakdown.',
      columns: 7,
      column_headers: ['Description', 'Quantity', 'Unit Price', 'Tax', 'RCV', 'Depreciation', 'ACV'],
      show_rcv_acv: false,
      show_depreciation: true,
      show_age_life: false,
      rcv_label: 'RCV',
      acv_label: 'ACV',
      show_overhead_profit: true,
      overhead_profit_rate: 10,
      show_claim_number: true,
      show_insurance_company: true,
      show_policy_number: true,
      show_deductible: true,
      show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing Allstate Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'Payment subject to policy terms and conditions.',
      page_size: 'letter',
      font_size: 'medium',
      color_scheme: 'blue',
      is_active: true,
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
      description: 'Symbility-compatible format with O&P as a dedicated per-line column. Matches Liberty Mutual, Safeco, and Erie carriers using Symbility.',
      columns: 9, column_headers: ['Description', 'Qty', 'Unit Price', 'O&P', 'Taxes', 'RC', 'Depreciation', 'ACV'],
      show_rcv_acv: true, show_depreciation: true, show_age_life: false,
      show_op_column: true,
      rcv_label: 'RC', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 20,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: true,
      header_text: isYICN ? 'YICN Roofing 216-999-6222' : `${co}`,
      footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO YOUR INSURED PROPERTY AND MAY BE REVISED AS WE CONTINUE TO EVALUATE YOUR CLAIM.',
      page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true,
    },
    {
      format_name: 'Farmers Standard',
      category: 'insurance',
      insurance_company: 'Farmers',
      description: 'Farmers Insurance standard format with depreciation and RCV/ACV calculations.',
      columns: 8,
      column_headers: ['Description', 'Quantity', 'Unit Price', 'Tax', 'RCV', 'Depreciation', 'ACV', 'Notes'],
      show_rcv_acv: true,
      show_depreciation: true,
      show_age_life: false,
      rcv_label: 'RCV',
      acv_label: 'ACV',
      show_overhead_profit: true,
      overhead_profit_rate: 10,
      show_claim_number: true,
      show_insurance_company: true,
      show_policy_number: true,
      show_deductible: true,
      show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing Farmers Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'All claim payments subject to policy provisions, limits, and deductibles.',
      page_size: 'letter',
      font_size: 'medium',
      color_scheme: 'green',
      is_active: true,
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
    console.log(`[Templates] Seeded ${seeded} templates for company ${companyId} (${companyName})`);
    return seeded;
  } catch (err) {
    console.error(`[Templates] Error seeding for ${companyId}:`, err.message);
    return 0;
  }
}

export default function dbPlugin() {
  let dbReady = false;
  let databaseInitAttempts = 0;
  let databaseInitRetryTimer = null;

  return {
    name: 'local-db-api',
    configureServer(server) {
      // Do not block Vite from binding port 5000 while the schema initializer
      // waits on database DDL locks. The middleware below already returns a
      // clear 503 until dbReady flips true, so initialization can safely finish
      // in the background without making the entire preview fail to start.
      const initializeDatabase = () => initDatabase()
        .then(() => {
          dbReady = true;
          databaseInitAttempts = 0;
          console.log('[DB Plugin] Database ready');
          nodeRequire('./lib/reencryptSecrets.cjs').reencryptStoredSecrets(getPool()).catch((error) => {
            console.warn('[reencrypt] skipped:', error.message);
          });

          (async () => {
            try {
              const p = getPool();
              console.log('[Security] Server startup: admin flag check skipped (owners may grant admin to any staff)');

            const affectedEmails = ['stonekevin866@gmail.com', 'brian.yicn@gmail.com', 'bickel941@gmail.com'];
            for (const email of affectedEmails) {
              const profileResult = await p.query(
                `SELECT id, data->>'role_id' as role_id, data->>'role_name' as role_name, company_id 
                 FROM generic_entities WHERE entity_type = 'StaffProfile' AND data->>'user_email' = $1`,
                [email]
              );
              for (const profile of profileResult.rows) {
                if (!profile.role_id || profile.role_id === '') {
                  const roleResult = await p.query(
                    `SELECT id, data->>'name' as name FROM generic_entities WHERE entity_type = 'StaffRole' AND company_id = $1 AND LOWER(data->>'name') LIKE '%insurance claims specialist%'`,
                    [profile.company_id]
                  );
                  if (roleResult.rows.length > 0) {
                    const role = roleResult.rows[0];
                    await p.query(
                      `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE id = $2`,
                      [JSON.stringify({ role_id: role.id, role_name: role.name }), profile.id]
                    );
                    console.log(`[Security] Auto-assigned role "${role.name}" to ${email}`);
                  } else {
                    console.warn(`[Security] WARNING: No "Insurance Claims Specialist" role found for company ${profile.company_id} — ${email} has no role assigned`);
                  }
                }
              }
            }
            } catch (err) {
              console.error('[Security] Server startup admin flag cleanup failed:', err.message);
            }

            // Patch: add O&P templates to any existing company that's missing them
            await patchMissingOpTemplates(getPool());
          })();
        })
        .catch((err) => {
          dbReady = false;
          databaseInitAttempts += 1;
          const retryDelayMs = Math.min(30000, 1000 * (2 ** Math.min(databaseInitAttempts - 1, 5)));
          console.error(
            `[DB Plugin] Database init failed: ${err.message}. Retrying in ${Math.round(retryDelayMs / 1000)}s.`
          );
          clearTimeout(databaseInitRetryTimer);
          databaseInitRetryTimer = setTimeout(initializeDatabase, retryDelayMs);
        });
      initializeDatabase();

      server.middlewares.use(async (req, res, next) => {
        const requestPath = new URL(req.url, 'http://localhost').pathname;
        if (requestPath === '/api/twilio/update-cache') {
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            });
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            return sendError(res, 'Method not allowed', 405);
          }

          try {
            const body = await parseBody(req);
            const {
              phone_number, company_id, routing_mode, cell_phone,
              availability_status, twilio_sid, validate_only,
            } = body;
            if (!phone_number || !company_id) {
              return sendError(res, 'phone_number and company_id required', 400);
            }

            const pool = getPool();
            const { authorizeTwilioTenant, assertTwilioIdentityAvailable } =
              nodeRequire('./lib/twilioTenantGuard.cjs');
            await authorizeTwilioTenant({ req, pool, companyId: company_id });
            await assertTwilioIdentityAvailable({
              pool, companyId: company_id, accountSid: twilio_sid, phoneNumber: phone_number,
            });

            // The development app resolves routing from the database on demand;
            // it has no production server's in-memory subscriber cache.
            if (validate_only === true) {
              return sendJson(res, { success: true, validated: true });
            }

            // Keep profile routing fields in step with production. Never log or
            // persist the request's Twilio token through this cache endpoint.
            try {
              const normalizedPhone = String(phone_number).replace(/[^\d+]/g, '');
              const updates = [];
              const values = [];
              if (routing_mode) {
                values.push(routing_mode);
                updates.push(`call_routing_mode = $${values.length}`);
              }
              if (availability_status) {
                values.push(availability_status);
                updates.push(`availability_status = $${values.length}`);
              }
              if (cell_phone) {
                values.push(cell_phone);
                updates.push(`cell_phone = $${values.length}`);
              }
              if (updates.length) {
                values.push(normalizedPhone, phone_number, company_id);
                await pool.query(
                  `UPDATE staff_profiles
                   SET ${updates.join(', ')}, updated_at = NOW()
                   WHERE (twilio_number = $${values.length - 2} OR twilio_number = $${values.length - 1})
                     AND company_id = $${values.length}`,
                  values
                );
              }
            } catch (error) {
              console.warn('[Twilio cache update] Staff profile sync failed:', error.message);
            }

            return sendJson(res, { success: true, cached: String(phone_number).replace(/[^\d+]/g, '') });
          } catch (error) {
            console.warn('[Twilio cache update] Request rejected:', error.message);
            return sendError(res, error.message || 'Twilio settings are not authorized for this company', error.statusCode || 500);
          }
        }

        if (req.url.startsWith('/api/public/customer')) {
          const { URL } = await import('url');
          const parsed = new URL(req.url, 'http://localhost');
          const customerId = parsed.searchParams.get('id');
          if (!customerId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'id required' }));
            return;
          }
          try {
            const pool = getPool();
            const result = await pool.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [customerId]);
            if (result.rows.length === 0) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Customer not found' }));
              return;
            }
            const customer = result.rows[0];
            const safe = {
              id: customer.id,
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
              street: customer.street,
              city: customer.city,
              state: customer.state,
              zip: customer.zip,
              company_id: customer.company_id,
            };
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ success: true, customer: safe }));
          } catch (err) {
            console.error('[Public API] Customer lookup error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Server error' }));
          }
          return;
        }

        // Impersonation management endpoints (super-admin only, full access)
        if (req.url.startsWith('/api/impersonation/')) {
         // Every route below awaits the database. Without this catch a pool
         // timeout became an unhandled rejection that killed the dev server.
         try {
          const pool = getPool();
          const { URL: UURL } = await import('url');
          const parsedUrl = new UURL(req.url, 'http://localhost');
          const iPath = parsedUrl.pathname;

          if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
            res.end();
            return;
          }

          if (iPath === '/api/impersonation/start' && req.method === 'POST') {
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated || !ctx.isSuperAdmin) return sendError(res, 'Super-admin access required', 403);
            const body = await parseBody(req);
            const { target_company_id, target_company_name, reason } = body;
            if (!target_company_id || !reason?.trim()) return sendError(res, 'target_company_id and reason are required', 400);
            const { randomUUID } = nodeRequire('crypto');
            const logId = randomUUID();
            // Fixed 30-minute policy — non-overridable by client regardless of body params
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
            // Atomic double-start prevention: acquire a transaction-scoped advisory lock
            // keyed by the admin's email before the existence check so two simultaneous
            // /start requests can't both pass the check and both insert active sessions.
            let existingCompanyName = null;
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              // Lock scoped to this transaction; released automatically on COMMIT/ROLLBACK.
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
              return sendError(res, `You already have an active session for "${existingCompanyName}". Stop it before starting a new one.`, 409);
            }
            if (req.session) {
              req.session.impersonating_company_id = target_company_id;
              req.session.impersonation_expires_at = expiresAt.toISOString();
              req.session.impersonation_log_id = logId;
            }
            try {
              const compRow = await pool.query('SELECT email, created_by FROM companies WHERE id = $1 LIMIT 1', [target_company_id]);
              const ownerEmail = compRow.rows[0]?.email || compRow.rows[0]?.created_by;
              if (ownerEmail && ownerEmail.includes('@')) {
                sendViaResend({
                  to: ownerEmail,
                  from: 'CompanySync <noreply@companysync.io>',
                  subject: '🔔 CompanySync Support Session Started',
                  html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#dc2626">Account Access Notification</h2><p>A CompanySync support agent started a support session for your account. They can view and make changes on your behalf to help resolve your issue or complete onboarding.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><td style="padding:8px;background:#f9fafb;font-weight:600">Reason</td><td style="padding:8px">${reason.trim()}</td></tr><tr><td style="padding:8px;background:#f9fafb;font-weight:600">Started</td><td style="padding:8px">${new Date().toUTCString()}</td></tr><tr><td style="padding:8px;background:#f9fafb;font-weight:600">Expires</td><td style="padding:8px">${expiresAt.toUTCString()}</td></tr></table><p style="color:#6b7280;font-size:13px">All support sessions are logged and you can review them in your Security &amp; Compliance settings. Questions? Contact io.companysync@gmail.com.</p></div>`,
                }).catch(e => console.warn('[Impersonation] Notification email failed:', e.message));
              }
            } catch (e) {
              console.warn('[Impersonation] Company email lookup failed:', e.message);
            }
            console.log(`[Security] IMPERSONATION START: ${ctx.email} → ${target_company_id} (${target_company_name}) reason: ${reason.trim()}`);
            return sendJson(res, { success: true, log_id: logId, expires_at: expiresAt.toISOString() });
          }

          if (iPath === '/api/impersonation/stop' && req.method === 'POST') {
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated || !ctx.isSuperAdmin) return sendError(res, 'Super-admin access required', 403);
            const logId = ctx._impersonationLogId;
            if (logId) {
              await pool.query(
                `UPDATE impersonation_logs SET ended_at = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60), is_active = false WHERE id = $1`,
                [logId]
              );
            }
            if (ctx._sid) {
              await pool.query(
                `UPDATE sessions SET sess = sess - 'impersonating_company_id' - 'impersonation_expires_at' - 'impersonation_log_id' WHERE sid = $1`,
                [ctx._sid]
              );
            }
            if (req.session) {
              delete req.session.impersonating_company_id;
              delete req.session.impersonation_expires_at;
              delete req.session.impersonation_log_id;
            }
            console.log(`[Security] IMPERSONATION STOP: ${ctx.email} (log: ${logId})`);
            return sendJson(res, { success: true });
          }

          // The browser tab is not the source of truth for impersonation: the
          // session cookie is. A reload or a second tab has no sessionStorage,
          // so without this the shell and the data layer disagree about which
          // tenant is active while the server still scopes/blocks by session.
          if (iPath === '/api/impersonation/status' && req.method === 'GET') {
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated) return sendError(res, 'Unauthorized', 401);
            if (!ctx.isImpersonating || !ctx.impersonatedCompanyId) {
              return sendJson(res, { active: false, company_id: null, company_name: null, expires_at: null });
            }
            let companyName = null;
            let expiresAt = null;
            try {
              if (ctx._impersonationLogId) {
                const logRow = await pool.query(
                  'SELECT target_company_name, expires_at FROM impersonation_logs WHERE id = $1',
                  [ctx._impersonationLogId]
                );
                companyName = logRow.rows[0]?.target_company_name || null;
                expiresAt = logRow.rows[0]?.expires_at || null;
              }
              if (!companyName) {
                const companyRow = await pool.query('SELECT company_name FROM companies WHERE id = $1', [ctx.impersonatedCompanyId]);
                companyName = companyRow.rows[0]?.company_name || null;
              }
            } catch (e) {
              console.warn('[Impersonation] Status lookup failed:', e.message);
            }
            return sendJson(res, {
              active: true,
              company_id: ctx.impersonatedCompanyId,
              company_name: companyName,
              expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
            });
          }

          if (iPath === '/api/impersonation/view-as' && req.method === 'POST') {
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated || !ctx.isSuperAdmin) return sendError(res, 'Super-admin access required', 403);
            const body = await parseBody(req);
            const { user_email } = body;
            const logId = ctx._impersonationLogId;
            if (logId && user_email) {
              await pool.query(
                `UPDATE impersonation_logs SET view_as_user_email = $1 WHERE id = $2 AND is_active = true`,
                [user_email, logId]
              ).catch(e => console.warn('[Impersonation] view-as update error:', e.message));
            }
            return sendJson(res, { success: true });
          }

          if (iPath === '/api/impersonation/logs' && req.method === 'GET') {
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated) return sendError(res, 'Unauthorized', 401);
            const type = parsedUrl.searchParams.get('type') || 'company';
            if (type === 'all') {
              if (!ctx.isSuperAdmin) return sendError(res, 'Super-admin access required', 403);
              const rows = await pool.query('SELECT * FROM impersonation_logs ORDER BY started_at DESC LIMIT 200');
              return sendJson(res, rows.rows);
            }
            const companyId = parsedUrl.searchParams.get('company_id');
            const ids = Array.from(ctx.allowedCompanyIds);
            const targetId = companyId || (ids.length > 0 ? ids[0] : null);
            if (!targetId) return sendJson(res, []);
            if (!ctx.isSuperAdmin && !ctx.allowedCompanyIds.has(targetId)) return sendError(res, 'Access denied', 403);
            const rows = await pool.query('SELECT * FROM impersonation_logs WHERE target_company_id = $1 ORDER BY started_at DESC LIMIT 100', [targetId]);
            return sendJson(res, rows.rows);
          }

          return next();
         } catch (e) {
           console.error('[Impersonation] Handler error:', e.message);
           return sendError(res, 'Impersonation service temporarily unavailable', 503);
         }
        }

        if (!req.url.startsWith('/api/local/')) return next();

        // Centralized impersonation guard for all /api/local/* requests.
        // • Returns 401 when the impersonation window has expired.
        // • Returns 403 for every non-GET mutation while an impersonation session is
        //   active — covers the entity API AND every specialized route (auto-categorize,
        //   sync, admin helpers, etc.) before any of those handlers can run.
        //   The per-entity-route checks below remain as defense-in-depth.
        try {
          const expCtx = await tenantGuard.resolveRequestContext(req, getPool());
          if (expCtx.impersonationExpired) {
            return sendError(res, 'Impersonation session expired. Please return to the admin dashboard.', 401);
          }
          if (expCtx.isImpersonating && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
            console.warn(`[Security] IMPERSONATION WRITE BLOCKED (central): ${expCtx.email} attempted ${req.method} ${req.url} while impersonating ${expCtx.impersonatedCompanyId}`);
            return sendError(res, 'Forbidden: data writes are not permitted during an impersonation session', 403);
          }
        } catch (_) { /* don't break unauthenticated/public local routes */ }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          });
          res.end();
          return;
        }

        const bulkUrl = new URL(req.url, 'http://internal');
        if (bulkUrl.pathname === '/api/local/bulk-delete-permission' && req.method === 'GET') {
          const pool = getPool();
          const ctx = await tenantGuard.resolveRequestContext(req, pool);
          const denied = bulkDeletion.contextError(ctx);
          if (denied) return sendError(res, denied.error, denied.status);
          return sendJson(res, { allowed: await bulkDeletion.canBulkDelete(pool, ctx, bulkUrl.searchParams.get('company_id')) });
        }
        const bulkDeleteMatch = bulkUrl.pathname.match(/^\/api\/local\/entity\/([^/]+)\/bulk-delete$/);
        if (bulkDeleteMatch && req.method === 'POST') {
          const pool = getPool();
          const entityType = sdkNameToEntityType(bulkDeleteMatch[1]);
          if (isInternalEntityType(entityType)) return sendError(res, 'Not found', 404);
          const ctx = await tenantGuard.resolveRequestContext(req, pool);
          const denied = bulkDeletion.contextError(ctx);
          if (denied) return sendError(res, denied.error, denied.status);
          const body = await parseBody(req);
          const result = await bulkDeletion.deleteBatch({
            pool, ctx, entityType, ids: body?.ids, validateOnly: body?.validateOnly === true,
            table: isDedicatedTable(entityType) ? DEDICATED_TABLES[entityType].table : 'generic_entities',
            authorizeRecord: (context, type, record) => {
              const own = tenantGuard.checkOwnership(context, type, record, 'BULK DELETE');
              if (own.blocked) return 'Not authorized to delete these records.';
              const settings = insuranceClaimWelcome.settingsWriteGuard(context, type, null, record);
              return settings.blocked ? settings.reason : null;
            },
          });
          return sendJson(res, result, result.status);
        }

        // ── Early body-size guard (must precede !dbReady so oversized probes get 413, not 503) ──
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const entityPutMatch = req.url.match(/^\/api\/local\/entity\/[^/]+\/[^/?]+/);
          if (entityPutMatch) {
            const contentLength = parseInt(req.headers['content-length'] || '0', 10);
            if (contentLength > 5 * 1024 * 1024) {
              return sendError(res, 'Request body too large (limit: 5 MB)', 413);
            }
          }
        }

        if (!dbReady) {
          return sendError(res, 'Database not ready', 503);
        }

        const urlPath = req.url.split('?')[0];
        const query = parseQuery(req.url);

        try {
          if (urlPath === '/api/local/invoices/link-customer' && req.method === 'POST') {
            const pool = getPool();
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated) return sendError(res, 'Unauthorized', 401);
            if (ctx.impersonationExpired) {
              return sendError(res, 'Impersonation session expired. Please return to the admin dashboard.', 401);
            }
            const body = await parseBody(req);
            const result = await invoiceCustomerLink.linkUnassignedInvoice({
              pool,
              ctx,
              invoiceId: body.invoice_id,
              customerId: body.customer_id,
              companyId: body.company_id,
              confirmed: body.confirmed,
            });
            return sendJson(res, result.body, result.status);
          }

          // ==========================================
          // TRANSACTION MAPPING RULES - SUGGEST CATEGORY
          // GET /api/local/suggest-category?description=X&company_id=Y
          // ==========================================
          if (urlPath === '/api/local/suggest-category' && req.method === 'GET') {
            const pool = getPool();
            const description = (query.description || '').toLowerCase().trim();
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const rulesResult = await pool.query(
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
            return sendJson(res, { suggestion: matched });
          }

          // ==========================================
          // TRANSACTION MAPPING RULES - AUTO CATEGORIZE
          // POST /api/local/auto-categorize
          // Body: { company_id, payment_ids? (optional array) }
          // ==========================================
          if (urlPath === '/api/local/auto-categorize' && req.method === 'POST') {
            const pool = getPool();
            const body = await parseBody(req);
            const { company_id, payment_ids } = body;
            if (!company_id) return sendError(res, 'company_id required', 400);

            const rulesResult = await pool.query(
              `SELECT * FROM transaction_mapping_rules WHERE company_id = $1 AND is_active = true ORDER BY priority DESC, created_at ASC`,
              [company_id]
            );
            const rules = rulesResult.rows;
            if (rules.length === 0) return sendJson(res, { updated: 0, message: 'No active rules found' });

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
            const paymentsResult = await pool.query(paymentsQuery, paymentsValues);
            const payments = paymentsResult.rows;

            let updatedCount = 0;
            for (const payment of payments) {
              const text = ((payment.description || '') + ' ' + (payment.notes || '') + ' ' + (payment.customer_name || '')).toLowerCase().trim();
              for (const rule of rules) {
                if (text.includes(rule.pattern.toLowerCase())) {
                  await pool.query(
                    `UPDATE payments SET category = $1, transaction_type = $2, updated_at = NOW() WHERE id = $3`,
                    [rule.category, rule.transaction_type, payment.id]
                  );
                  updatedCount++;
                  break;
                }
              }
            }
            return sendJson(res, { updated: updatedCount, total: payments.length });
          }

          // ==========================================
          // UNIVERSAL ENTITY CRUD API
          // Pattern: /api/local/entity/{EntityType}
          // Pattern: /api/local/entity/{EntityType}/{id}
          // ==========================================
          const entitySingleMatch = urlPath.match(/^\/api\/local\/entity\/([^/]+)\/([^/]+)$/);
          const entityCollectionMatch = !entitySingleMatch && urlPath.match(/^\/api\/local\/entity\/([^/]+)$/);

          if (entityCollectionMatch) {
            const pool = getPool();
            const sdkName = entityCollectionMatch[1];
            const entityType = sdkNameToEntityType(sdkName);
            if (isInternalEntityType(entityType)) {
              return sendError(res, 'Not found', 404);
            }

            const tenantCtx = await tenantGuard.resolveRequestContext(req, pool);
            if (!tenantCtx.authenticated) return sendError(res, 'Unauthorized', 401);
            if (tenantCtx.impersonationExpired) {
              return sendError(res, 'Impersonation session expired. Please return to the admin dashboard.', 401);
            }
            // Defense-in-depth: per-route write-block (centralized guard above fires first).
            if (tenantCtx.isImpersonating && req.method !== 'GET') {
              console.warn(`[Security] IMPERSONATION WRITE BLOCKED: ${tenantCtx.email} attempted ${req.method} on ${sdkName} while impersonating ${tenantCtx.impersonatedCompanyId}`);
              return sendError(res, 'Forbidden: data writes are not permitted during an impersonation session', 403);
            }
            if (req.method === 'GET') {
              const filters = {};
              for (const [k, v] of Object.entries(query)) {
                if (k === '_sort' || k === '_limit' || k === '_offset') continue;
                filters[k] = parseFilterValue(v);
              }
              if (entityType === 'signing_sessions') {
                console.log(`[Entity GET] signing_sessions filters:`, JSON.stringify(filters));
              }
              const scopedFilters = tenantGuard.scopeListFilters(tenantCtx, filters, entityType);
              const sort = query._sort || '-created_date';
              const limit = parseInt(query._limit) || 1000;
              const results = await genericFilter(pool, entityType, scopedFilters, sort, limit);
              return sendJson(res, results);
            }

            if (req.method === 'POST') {
              let body = await parseBody(req);
              const welcomeSettingsGuard = insuranceClaimWelcome.settingsWriteGuard(tenantCtx, entityType, body);
              if (welcomeSettingsGuard.blocked) return sendError(res, welcomeSettingsGuard.reason, 403);

              if (Array.isArray(body)) {
                body = body.map(item => tenantGuard.sanitizeChangeOrderOnCreate(tenantCtx, entityType, tenantGuard.stripProtectedSubscriptionFields(tenantCtx, entityType, tenantGuard.stripProtectedBillingFields(tenantCtx, entityType, tenantGuard.enforceCompanyCreatedBy(tenantCtx, entityType, tenantGuard.enforceCreateCompanyId(tenantCtx, item, `POST ${sdkName} (bulk)`), `POST ${sdkName} (bulk)`), `POST ${sdkName} (bulk)`), true, `POST ${sdkName} (bulk)`), `POST ${sdkName} (bulk)`));
                const seenCalEvents = [];
                for (const item of body) {
                  const claim = await tenantGuard.verifyNoCompanyCreateTarget(tenantCtx, entityType, item, pool, `POST ${sdkName} (bulk)`);
                  if (claim.blocked) return sendError(res, claim.reason, 403);
                  const invoiceCustomerCheck = await invoiceCustomerLink.validateInvoiceCustomerReference(
                    pool, entityType, item, `POST ${sdkName} (bulk)`
                  );
                  if (invoiceCustomerCheck.blocked) return sendError(res, invoiceCustomerCheck.reason, 400);
                  // Double-booking guard: check against DB rows + earlier items in this batch
                  if (sdkName === 'CalendarEvent') {
                    const intraConflict = checkIntraPayloadCalendarConflict(seenCalEvents, item);
                    if (intraConflict) return sendJson(res, { error: intraConflict.message, conflict: true, existing: intraConflict.existing }, 409);
                    const bulkConflict = await checkCalendarBookingConflict(pool, item, null);
                    if (bulkConflict) return sendJson(res, { error: bulkConflict.message, conflict: true, existing: bulkConflict.existing }, 409);
                    seenCalEvents.push(item);
                  }
                }
                // ── Server-side entity count limit gate (bulk) ──────────────────
                // Enforce single-company payloads: enforceCreateCompanyId above
                // stamps the session company onto every item, but an explicit check
                // here guards against any future drift in that invariant.
                // LOCKSTEP: same check in db/prod-db.cjs; keep in sync.
                {
                  const uniqueCompanyIds = [...new Set(body.map(item => item.company_id).filter(Boolean))];
                  if (uniqueCompanyIds.length > 1) {
                    return sendError(res, 'Bulk creates must all belong to the same company', 400);
                  }
                  const bulkCompanyId = uniqueCompanyIds[0] || null;
                  const limitCheck = await checkEntityCreationLimit(pool, entityType, bulkCompanyId, tenantCtx.isSuperAdmin, body.length);
                  if (!limitCheck.allowed) return sendError(res, limitCheck.error, 403);
                }
                const results = await genericBulkCreate(pool, entityType, body);
                return sendJson(res, results, 201);
              }

              body = tenantGuard.enforceCreateCompanyId(tenantCtx, body, `POST ${sdkName}`);
              body = tenantGuard.enforceCompanyCreatedBy(tenantCtx, entityType, body, `POST ${sdkName}`);
              body = tenantGuard.stripProtectedBillingFields(tenantCtx, entityType, body, `POST ${sdkName}`);
              body = tenantGuard.stripProtectedSubscriptionFields(tenantCtx, entityType, body, true, `POST ${sdkName}`);
              body = tenantGuard.sanitizeChangeOrderOnCreate(tenantCtx, entityType, body, `POST ${sdkName}`);
              {
                const claim = await tenantGuard.verifyNoCompanyCreateTarget(tenantCtx, entityType, body, pool, `POST ${sdkName}`);
                if (claim.blocked) return sendError(res, claim.reason, 403);
              }
              const invoiceCustomerCheck = await invoiceCustomerLink.validateInvoiceCustomerReference(
                pool, entityType, body, `POST ${sdkName}`
              );
              if (invoiceCustomerCheck.blocked) return sendError(res, invoiceCustomerCheck.reason, 400);

              // Validate and normalize approval_alert_phone when creating a Company
              if (sdkName === 'Company' && body?.settings?.approval_alert_phone) {
                const phoneResult = validateAndNormalizeE164(body.settings.approval_alert_phone);
                if (phoneResult.error) return sendError(res, phoneResult.error, 400);
                body.settings = { ...body.settings, approval_alert_phone: phoneResult.normalized };
              }

              const dupCheck = await checkDuplicateBeforeCreate(pool, entityType, body);
              if (dupCheck) {
                return sendJson(res, { error: dupCheck.message, duplicate: true, existing_id: dupCheck.existingId }, 409);
              }

              // Double-booking guard for CalendarEvent creates
              if (sdkName === 'CalendarEvent') {
                const bookingConflict = await checkCalendarBookingConflict(pool, body, null);
                if (bookingConflict) {
                  return sendJson(res, { error: bookingConflict.message, conflict: true, existing: bookingConflict.existing }, 409);
                }
              }

              // ── Server-side entity count limit gate (staff / customer / lead) ──
              // LOCKSTEP: same check in db/prod-db.cjs; keep in sync.
              {
                const limitCheck = await checkEntityCreationLimit(pool, entityType, body.company_id, tenantCtx.isSuperAdmin);
                if (!limitCheck.allowed) return sendError(res, limitCheck.error, 403);
              }

              const created = await genericCreate(pool, entityType, body);
              if (sdkName === 'Project' || sdkName === 'Customer') sendNewClaimWelcome(pool, 'create', null, created, sdkName);

              // Fire bell + email notifications — use sdkName (e.g. 'Lead') not table name ('leads')
              const notifConfig = getEntityNotificationConfig(sdkName, 'create', created);
              if (notifConfig && created.company_id) {
                notifyAdmins(created.company_id, notifConfig)
                  .catch(e => console.warn(`[DB] Notification failed for ${sdkName}:`, e.message));
              }

              // Fire workflow automations (non-blocking)
              if (created.company_id) {
                functionHandlers.autoTriggerWorkflowsFromMutation({
                  entity_type: sdkName,
                  mutation_type: 'create',
                  entity_id: created.id,
                  entity_data: created,
                  company_id: created.company_id,
                }).catch(e => console.warn(`[DB] Workflow trigger failed for ${sdkName} create:`, e.message));
                // CompanySync Bot chat alert (non-blocking)
                chatBot.notifyEntityEvent(pool, { sdkName, mutationType: 'create', before: null, after: created })
                  .catch(e => console.warn(`[ChatBot] alert failed for ${sdkName} create:`, e.message));
              }

              return sendJson(res, created, 201);
            }
          }

          if (entitySingleMatch) {
            const pool = getPool();
            const sdkName = entitySingleMatch[1];
            const entityType = sdkNameToEntityType(sdkName);
            const recordId = entitySingleMatch[2];
            if (isInternalEntityType(entityType)) {
              return sendError(res, 'Not found', 404);
            }

            if (req.method === 'PUT' || req.method === 'PATCH') {
              // Body-size check MUST run before auth so oversized-body probes still get 413
              // without needing a session (see scripts/test-body-limit.cjs).
              const contentLength = parseInt(req.headers['content-length'] || '0', 10);
              if (contentLength > 5 * 1024 * 1024) {
                return sendError(res, 'Request body too large (limit: 5 MB)', 413);
              }
            }

            const tenantCtx = await tenantGuard.resolveRequestContext(req, pool);
            if (!tenantCtx.authenticated) return sendError(res, 'Unauthorized', 401);
            if (tenantCtx.impersonationExpired) {
              return sendError(res, 'Impersonation session expired. Please return to the admin dashboard.', 401);
            }
            // Write-block: impersonation sessions are read-only — no mutations allowed.
            if (tenantCtx.isImpersonating && req.method !== 'GET') {
              console.warn(`[Security] IMPERSONATION WRITE BLOCKED: ${tenantCtx.email} attempted ${req.method} on ${sdkName}/${recordId} while impersonating ${tenantCtx.impersonatedCompanyId}`);
              return sendError(res, 'Forbidden: data writes are not permitted during an impersonation session', 403);
            }
            if (req.method === 'GET') {
              const record = await genericGet(pool, entityType, recordId);
              if (!record) return sendError(res, 'Not found', 404);
              const own = tenantGuard.checkOwnership(tenantCtx, entityType, record, `GET ${sdkName}`);
              if (own.blocked) return sendError(res, 'Not found', 404);
              return sendJson(res, record);
            }

            if (req.method === 'PUT' || req.method === 'PATCH') {
              const existing = await genericGet(pool, entityType, recordId);
              const welcomeSettingsGuard = insuranceClaimWelcome.settingsWriteGuard(tenantCtx, entityType, null, existing);
              if (welcomeSettingsGuard.blocked) return sendError(res, welcomeSettingsGuard.reason, 403);
              if (existing) {
                const own = tenantGuard.checkOwnership(tenantCtx, entityType, existing, `PUT ${sdkName}`);
                if (own.blocked) return sendError(res, 'Not found', 404);
              }
              console.log(`[DB] PUT /api/local/entity/${sdkName}/${recordId} — parsing body`);
              let body = await parseBody(req);
              console.log(`[DB] PUT body keys: ${Object.keys(body).join(', ')}`);
              body = tenantGuard.stripCompanyIdFromUpdate(tenantCtx, body);
              body = tenantGuard.stripProtectedBillingFields(tenantCtx, entityType, body, `PUT ${sdkName}`);
              body = tenantGuard.stripProtectedSubscriptionFields(tenantCtx, entityType, body, false, `PUT ${sdkName}`);
              const adminSettingsCheck = tenantGuard.enforceAdminOnlyCompanySettings(tenantCtx, entityType, body, existing, `PUT ${sdkName}`);
              if (adminSettingsCheck.blocked) return sendError(res, adminSettingsCheck.reason, 403);
              const adminFieldsCheck = tenantGuard.enforceAdminOnlyCompanyFields(tenantCtx, entityType, body, existing, `PUT ${sdkName}`);
              if (adminFieldsCheck.blocked) return sendError(res, adminFieldsCheck.reason, 403);
              const changeOrderCheck = await tenantGuard.enforceChangeOrderApproval(tenantCtx, entityType, body, existing, getPool(), `PUT ${sdkName}`);
              if (changeOrderCheck.blocked) return sendError(res, changeOrderCheck.reason, 403);
              body = changeOrderCheck.body;
              const invoiceCustomerUpdateCheck = invoiceCustomerLink.guardInvoiceCustomerUpdate(entityType, existing, body);
              if (invoiceCustomerUpdateCheck.blocked) return sendError(res, invoiceCustomerUpdateCheck.reason, 403);
              const invoiceCustomerReferenceCheck = await invoiceCustomerLink.validateInvoiceCustomerReference(
                pool, entityType, { ...existing, ...body }, `PUT ${sdkName}`
              );
              if (invoiceCustomerReferenceCheck.blocked) return sendError(res, invoiceCustomerReferenceCheck.reason, 400);

              // Validate and normalize approval_alert_phone when saving Company settings
              if (sdkName === 'Company' && body?.settings?.approval_alert_phone) {
                const phoneResult = validateAndNormalizeE164(body.settings.approval_alert_phone);
                if (phoneResult.error) return sendError(res, phoneResult.error, 400);
                body.settings = { ...body.settings, approval_alert_phone: phoneResult.normalized };
              }

              // Double-booking guard for CalendarEvent updates
              if (sdkName === 'CalendarEvent' && existing) {
                const mergedState = { ...existing, ...body };
                if (mergedState.start_time && mergedState.end_time) {
                  const bookingConflict = await checkCalendarBookingConflict(pool, mergedState, recordId);
                  if (bookingConflict) {
                    return sendJson(res, { error: bookingConflict.message, conflict: true, existing: bookingConflict.existing }, 409);
                  }
                }
              }

              const updated = await genericUpdate(pool, entityType, recordId, body);
              if (sdkName === 'Project' || sdkName === 'Customer') sendNewClaimWelcome(pool, 'update', existing, updated, sdkName);

              // Fire workflow automations on update — catches status changes like invoice_paid, estimate_accepted
              if (updated && updated.company_id) {
                functionHandlers.autoTriggerWorkflowsFromMutation({
                  entity_type: sdkName,
                  mutation_type: 'update',
                  entity_id: recordId,
                  entity_data: updated,
                  company_id: updated.company_id,
                }).catch(e => console.warn(`[DB] Workflow trigger failed for ${sdkName} update:`, e.message));
                // CompanySync Bot chat alert on status transitions (non-blocking)
                chatBot.notifyEntityEvent(pool, { sdkName, mutationType: 'update', before: existing, after: updated })
                  .catch(e => console.warn(`[ChatBot] alert failed for ${sdkName} update:`, e.message));
              }

              return sendJson(res, updated);
            }

            if (req.method === 'DELETE') {
              const existing = await genericGet(pool, entityType, recordId);
              const welcomeSettingsGuard = insuranceClaimWelcome.settingsWriteGuard(tenantCtx, entityType, null, existing);
              if (welcomeSettingsGuard.blocked) return sendError(res, welcomeSettingsGuard.reason, 403);
              if (existing) {
                const own = tenantGuard.checkOwnership(tenantCtx, entityType, existing, `DELETE ${sdkName}`);
                if (own.blocked) return sendError(res, 'Not found', 404);
              }
              // Role-level delete guard: non-admins may only delete calendar events they own.
              // Admins and super-admins bypass this check.
              if (entityType === 'calendar_events' && !tenantCtx.isSuperAdmin && !tenantCtx.isAdministrator) {
                const eventOwner = existing?.assigned_to;
                if (eventOwner && eventOwner !== tenantCtx.email) {
                  console.warn(`[Security] ${tenantCtx.email} attempted to delete CalendarEvent ${recordId} owned by ${eventOwner} — blocked`);
                  return sendError(res, 'Not authorized to delete this event', 403);
                }
              }
              const deleted = await genericDelete(pool, entityType, recordId);
              if (!deleted) return sendError(res, 'Not found', 404);
              return sendJson(res, { success: true, deleted: true });
            }
          }

          // ==========================================
          // EXISTING SPECIALIZED ENDPOINTS (kept for backward compatibility)
          // ==========================================
          if (urlPath === '/api/local/dashboard' && req.method === 'GET') {
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const data = await getDashboardData(companyId);
            return sendJson(res, { success: true, data, source: 'local_db' });
          }

          if (urlPath === '/api/local/sync' && req.method === 'POST') {
            const body = await parseBody(req);
            const { entity_type, records, company_id } = body;
            if (!entity_type || !records) return sendError(res, 'entity_type and records required', 400);
            const result = await syncEntityBatch(entity_type, records, company_id);
            return sendJson(res, { success: true, ...result });
          }

          if (urlPath === '/api/local/sync/call-routing' && req.method === 'POST') {
            const body = await parseBody(req);
            const { records } = body;
            if (!records) return sendError(res, 'records required', 400);
            const result = await syncCallRoutingCache(records);
            return sendJson(res, { success: true, ...result });
          }

          if (urlPath === '/api/local/sync/status' && req.method === 'GET') {
            const status = await getSyncStatus();
            return sendJson(res, { success: true, status });
          }

          if (urlPath === '/api/local/sync/bulk' && req.method === 'POST') {
            const body = await parseBody(req);
            const { entities, company_id } = body;
            if (!entities || !company_id) return sendError(res, 'entities and company_id required', 400);

            const results = {};
            for (const [entityType, records] of Object.entries(entities)) {
              results[entityType] = await syncEntityBatch(entityType, records, company_id);
            }
            return sendJson(res, { success: true, results });
          }

          const oldEntityMatch = urlPath.match(/^\/api\/local\/entities\/(\w+)$/);
          if (oldEntityMatch && req.method === 'GET') {
            const entityType = oldEntityMatch[1];
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const data = await getEntityList(entityType, companyId, {
              limit: parseInt(query.limit) || 200,
              offset: parseInt(query.offset) || 0,
              status: query.status,
              sort: query.sort,
              order: query.order,
              search: query.search,
            });
            return sendJson(res, { success: true, ...data, source: 'local_db' });
          }

          if (urlPath === '/api/local/call-routing' && req.method === 'GET') {
            const phone = query.phone;
            if (!phone) return sendError(res, 'phone required', 400);
            const data = await getCallRouting(phone);
            return sendJson(res, { success: true, data, source: 'local_db' });
          }

          if (urlPath === '/api/local/staff/by-twilio' && req.method === 'GET') {
            const phone = query.phone;
            if (!phone) return sendError(res, 'phone required', 400);
            const data = await getStaffByTwilioNumber(phone);
            return sendJson(res, { success: true, data, source: 'local_db' });
          }

          if (urlPath === '/api/local/reports' && req.method === 'GET') {
            const companyId = query.company_id;
            const reportType = query.type;
            if (!companyId || !reportType) return sendError(res, 'company_id and type required', 400);
            const data = await getReportingData(companyId, reportType);
            return sendJson(res, { success: true, data, source: 'local_db' });
          }

          const dailyAIUsageMatch = urlPath.match(/^\/api\/local\/daily-ai-usage\/(.+)$/);
          if (dailyAIUsageMatch && req.method === 'GET') {
            const cid = dailyAIUsageMatch[1];
            const pool = getPool();
            const TRIAL_DAILY_LIMIT = 20;
            const today = new Date().toISOString().slice(0, 10);
            const recordId = `daily_ai_${cid}_${today}`;
            const { rows: planRows } = await pool.query(
              `SELECT subscription_plan FROM companies WHERE id = $1 LIMIT 1`, [cid]
            );
            const plan = planRows[0]?.subscription_plan || 'trial';
            const { rows: usageRows } = await pool.query(
              `SELECT data FROM generic_entities WHERE id = $1 LIMIT 1`, [recordId]
            );
            const data = usageRows[0]?.data;
            const d = typeof data === 'string' ? JSON.parse(data) : (data || {});
            const used = d.count || 0;
            const limit = plan === 'trial' ? TRIAL_DAILY_LIMIT : null;
            return sendJson(res, {
              success: true,
              used,
              limit,
              plan,
              remaining: limit !== null ? Math.max(0, limit - used) : null,
              resets_at: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
            });
          }

          if (urlPath === '/api/local/auto-provision' && req.method === 'POST') {
            const pool = getPool();
            const sessionEmail = await tenantGuard.resolveSessionEmail(req, pool);
            if (!sessionEmail) return sendError(res, 'Unauthorized', 401);
            const rl = rateLimit.checkRateLimit(`auto-provision:${rateLimit.getClientIp(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
            if (!rl.allowed) return sendError(res, 'Too many requests, please try again later.', 429);
            const body = await parseBody(req);
            const { name, attribution } = body;
            const email = sessionEmail;
            const emailLower = email.toLowerCase().trim();

            const existingCompanies = await pool.query(
              'SELECT * FROM companies WHERE LOWER(created_by) = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1',
              [emailLower]
            );
            if (existingCompanies.rows.length > 0) {
              const comp = existingCompanies.rows[0];
              const existingStaff = await pool.query(
                'SELECT * FROM staff_profiles WHERE (LOWER(user_email) = $1 OR LOWER(email) = $1) LIMIT 1',
                [emailLower]
              );
              if (existingStaff.rows.length === 0) {
                const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                await pool.query(
                  `INSERT INTO staff_profiles (id, company_id, name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, 'admin', true, true, true, NOW(), NOW())`,
                  [staffId, comp.id, name || email.split('@')[0], email, email]
                );
              }
              backfillOrphanedRecords(pool, comp.id).catch(err => console.error('[Backfill] Error:', err.message));
              return sendJson(res, { company: comp, staffProfile: existingStaff.rows[0] || null, created: false });
            }

            const existingStaffAny = await pool.query(
              'SELECT sp.*, c.id as comp_id FROM staff_profiles sp LEFT JOIN companies c ON sp.company_id = c.id WHERE (LOWER(sp.user_email) = $1 OR LOWER(sp.email) = $1) LIMIT 1',
              [emailLower]
            );
            if (existingStaffAny.rows.length > 0 && existingStaffAny.rows[0].comp_id) {
              const comp = await pool.query('SELECT * FROM companies WHERE id = $1', [existingStaffAny.rows[0].comp_id]);
              if (comp.rows.length > 0) {
                backfillOrphanedRecords(pool, comp.rows[0].id).catch(err => console.error('[Backfill] Error:', err.message));
                return sendJson(res, { company: comp.rows[0], staffProfile: existingStaffAny.rows[0], created: false });
              }
            }

            const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const displayName = name || email.split('@')[0];
            const companyName = `${displayName}'s Company`;

            await pool.query(
              `INSERT INTO companies (id, name, company_name, created_by, email, preferred_language, subscription_plan, subscription_status, is_deleted, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'en', 'professional', 'pending', false, NOW(), NOW())`,
              [companyId, companyName, companyName, email, email]
            );

            const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await pool.query(
              `INSERT INTO staff_profiles (id, company_id, name, full_name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, true, true, NOW(), NOW())`,
              [staffId, companyId, displayName, displayName, email, email]
            );

            try {
              const { attributionFromRequest, saveMarketingAttribution } = nodeRequire('./lib/marketingAttribution.cjs');
              const attr = attributionFromRequest(req, attribution);
              if (attr) await saveMarketingAttribution(pool, companyId, attr);
            } catch (attrErr) {
              console.warn('[Auto-Provision] attribution save failed:', attrErr.message);
            }
            const trialResult = await functionHandlers.startCompanyTrial(
              { companyId, plan: 'professional', attribution },
              null,
              {
                __trustedSignupOrchestrator: true,
                internalCaller: {
                  email,
                  company_id: companyId,
                  is_super_admin: false,
                  is_administrator: true,
                },
                headers: req.headers,
                socket: req.socket,
              }
            );
            if (!trialResult?.success) {
              await pool.query(
                'DELETE FROM staff_profiles WHERE company_id = $1 AND LOWER(user_email) = $2',
                [companyId, emailLower]
              );
              await pool.query(
                `DELETE FROM companies
                 WHERE id = $1 AND LOWER(created_by) = $2 AND subscription_status = 'pending'`,
                [companyId, emailLower]
              );
              return sendError(res, trialResult?.error || 'Unable to start the free trial', 500);
            }

            backfillOrphanedRecords(pool, companyId).catch(err => console.error('[Backfill] Error:', err.message));
            seedDefaultTemplates(pool, companyId, companyName).catch(err => console.error('[Templates] Error seeding on provision:', err.message));
            functionHandlers.setupDefaultWorkflows({ companyId }).catch(err => console.error('[Workflows] Error setting up default workflows on provision:', err.message));

            const newCompany = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
            console.log(`[Auto-Provision] Created company "${companyName}" (${companyId}) and staff profile for ${email}`);

            // Send welcome email to new company + admin notification (fire and forget)
            sendNewCompanyEmails({ email, displayName, companyName, companyId }).catch(err =>
              console.error('[Auto-Provision] Email notification error:', err.message)
            );

            return sendJson(res, {
              company: newCompany.rows[0],
              staffProfile: { id: staffId },
              created: true,
              tracking: trialResult?.tracking || { event_id: `trial_signup_${companyId}`, is_new_trial: trialResult?.signup_event_claimed === true },
            });
          }

          if (urlPath === '/api/local/admin/seed-templates' && req.method === 'POST') {
            const pool = getPool();
            const body = await parseBody(req);
            const { company_id } = body;
            if (company_id) {
              const comp = await pool.query('SELECT id, company_name FROM companies WHERE id = $1', [company_id]);
              if (comp.rows.length === 0) return sendError(res, 'Company not found', 404);
              const row = comp.rows[0];
              await pool.query("DELETE FROM generic_entities WHERE entity_type = 'EstimateFormat' AND company_id = $1", [row.id]);
              const seeded = await seedDefaultTemplates(pool, row.id, row.company_name);
              return sendJson(res, { success: true, seeded, company_id: row.id });
            }
            const companies = await pool.query('SELECT id, company_name FROM companies WHERE is_deleted IS NULL OR is_deleted = false');
            const results = [];
            for (const row of companies.rows) {
              await pool.query("DELETE FROM generic_entities WHERE entity_type = 'EstimateFormat' AND company_id = $1", [row.id]);
              const seeded = await seedDefaultTemplates(pool, row.id, row.company_name);
              results.push({ company_id: row.id, company_name: row.company_name, seeded });
            }
            return sendJson(res, { success: true, results, total_companies: results.length });
          }

          if (urlPath === '/api/local/admin/scan-orphan-companies' && req.method === 'GET') {
            const pool = getPool();
            const result = await pool.query(`
              WITH all_ids AS (
                SELECT DISTINCT company_id FROM customers WHERE company_id IS NOT NULL
                UNION SELECT DISTINCT company_id FROM leads WHERE company_id IS NOT NULL
                UNION SELECT DISTINCT company_id FROM invoices WHERE company_id IS NOT NULL
                UNION SELECT DISTINCT company_id FROM estimates WHERE company_id IS NOT NULL
                UNION SELECT DISTINCT company_id FROM staff_profiles WHERE company_id IS NOT NULL
                UNION SELECT DISTINCT company_id FROM generic_entities WHERE company_id IS NOT NULL
              ),
              registered AS (SELECT id FROM companies)
              SELECT a.company_id FROM all_ids a
              WHERE a.company_id NOT IN (SELECT id FROM registered)
            `);
            const orphans = [];
            for (const row of result.rows) {
              const cid = row.company_id;
              const counts = await pool.query(`
                SELECT
                  (SELECT COUNT(*) FROM customers WHERE company_id = $1) as customers,
                  (SELECT COUNT(*) FROM leads WHERE company_id = $1) as leads,
                  (SELECT COUNT(*) FROM invoices WHERE company_id = $1) as invoices,
                  (SELECT COUNT(*) FROM estimates WHERE company_id = $1) as estimates,
                  (SELECT COUNT(*) FROM staff_profiles WHERE company_id = $1) as staff,
                  (SELECT COUNT(*) FROM generic_entities WHERE company_id = $1) as entities
              `, [cid]);
              orphans.push({ company_id: cid, ...counts.rows[0] });
            }
            return sendJson(res, { success: true, orphans });
          }

          if (urlPath === '/api/local/admin/register-orphan-company' && req.method === 'POST') {
            const pool = getPool();
            const body = await parseBody(req);
            const { company_id, company_name } = body;
            if (!company_id) return sendError(res, 'company_id required', 400);
            const name = company_name || company_id;
            await pool.query(`
              INSERT INTO companies (id, company_name, name, subscription_plan, subscription_status, max_users, max_leads, is_deleted, created_at, updated_at)
              VALUES ($1, $2, $2, 'enterprise', 'active', 999, 999999, false, NOW(), NOW())
              ON CONFLICT (id) DO UPDATE SET company_name = $2, subscription_status = 'active', is_deleted = false, updated_at = NOW()
            `, [company_id, name]);
            return sendJson(res, { success: true, company_id, company_name: name });
          }

          if (urlPath === '/api/local/admin/fix-assignments' && req.method === 'POST') {
            const pool = getPool();
            const COMPANY_ID = 'loc_mmdvp1h5_e8i9eb';
            const BRIAN_EMAIL = 'brian.yicn@gmail.com';
            const KEVIN_EMAIL = 'stonekevin866@gmail.com';
            const results = {};

            // ── Step 1: Fix Patrick Gilmore's typo email → Brian ──────────────────
            // His record already has brian.ycinteam@gmail.com (typo). Correct it.
            const patrickLeadFix = await pool.query(`
              UPDATE leads
              SET assigned_to = $1,
                  assigned_to_users = jsonb_build_array($1::text),
                  updated_at = NOW()
              WHERE company_id = $2
                AND name ILIKE '%patrick gilmor%'
                AND (assigned_to = 'brian.ycinteam@gmail.com' OR assigned_to_users::text ILIKE '%brian.ycinteam%')
              RETURNING id, name, assigned_to
            `, [BRIAN_EMAIL, COMPANY_ID]);
            results.patrick_lead_fixed = patrickLeadFix.rows;

            // Also fix any other leads/customers that still have the typo email
            const typoLeadFix = await pool.query(`
              UPDATE leads
              SET assigned_to = $1,
                  assigned_to_users = jsonb_build_array($1::text),
                  updated_at = NOW()
              WHERE company_id = $2
                AND assigned_to = 'brian.ycinteam@gmail.com'
              RETURNING id, name
            `, [BRIAN_EMAIL, COMPANY_ID]);
            results.typo_leads_fixed = typoLeadFix.rowCount;

            const typoCustFix = await pool.query(`
              UPDATE customers
              SET assigned_to = $1,
                  assigned_to_users = jsonb_build_array($1::text),
                  updated_at = NOW()
              WHERE company_id = $2
                AND assigned_to = 'brian.ycinteam@gmail.com'
              RETURNING id, name
            `, [BRIAN_EMAIL, COMPANY_ID]);
            results.typo_customers_fixed = typoCustFix.rowCount;

            // ── Step 2: Set all remaining orphaned customers → Kevin ───────────────
            // Only touches records with NO assigned_to AND empty assigned_to_users
            const orphanCust = await pool.query(`
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

            // ── Step 3: Set all remaining orphaned leads → Kevin ──────────────────
            const orphanLeads = await pool.query(`
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

            // ── Step 4: Count Brian's records after all updates ───────────────────
            const brianLeadCount = await pool.query(`
              SELECT COUNT(*) as total FROM leads
              WHERE company_id = $1
                AND (assigned_to = $2 OR assigned_to_users::text ILIKE $3)
            `, [COMPANY_ID, BRIAN_EMAIL, `%${BRIAN_EMAIL}%`]);

            const brianCustCount = await pool.query(`
              SELECT COUNT(*) as total FROM customers
              WHERE company_id = $1
                AND (assigned_to = $2 OR assigned_to_users::text ILIKE $3)
            `, [COMPANY_ID, BRIAN_EMAIL, `%${BRIAN_EMAIL}%`]);

            results.brian_leads_total = parseInt(brianLeadCount.rows[0].total);
            results.brian_customers_total = parseInt(brianCustCount.rows[0].total);

            console.log('[Fix-Assignments]', JSON.stringify(results));
            return sendJson(res, { success: true, ...results });
          }

          // ==========================================
          // POST /api/local/setup-child-company-owner
          // Privileged endpoint: creates an owner StaffProfile for the caller in a
          // newly-created child company.  The entity-API path is blocked by
          // tenantGuard in enforce mode because the new company isn't yet in the
          // caller's allowedCompanyIds.  This endpoint verifies ownership via
          // companies.created_by (stamped by enforceCompanyCreatedBy) and inserts
          // directly, bypassing the tenant guard.
          // LOCKSTEP: keep in sync with the equivalent block in db/prod-db.cjs.
          // ==========================================
          if (urlPath === '/api/local/setup-child-company-owner' && req.method === 'POST') {
            const pool = getPool();
            const ctx = await tenantGuard.resolveRequestContext(req, pool);
            if (!ctx.authenticated) return sendError(res, 'Authentication required', 401);
            const body = await parseBody(req);
            const { company_id } = body;
            if (!company_id) return sendError(res, 'company_id required', 400);
            // Verify caller is the creator of the target child company
            const compRow = await pool.query(
              `SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1`,
              [company_id]
            );
            if (!compRow.rows.length) return sendError(res, 'Company not found', 404);
            const storedCreatedBy = (compRow.rows[0].created_by || '').toLowerCase();
            if (storedCreatedBy !== (ctx.email || '').toLowerCase()) {
              console.warn(`[Security] setup-child-company-owner: ${ctx.email} is not created_by of ${company_id}`);
              return sendError(res, 'Forbidden: you are not the creator of this company', 403);
            }
            // Check if an owner StaffProfile already exists for this user+company
            const existing = await pool.query(
              `SELECT id FROM staff_profiles WHERE company_id = $1 AND (LOWER(user_email) = $2 OR LOWER(email) = $2) LIMIT 1`,
              [company_id, ctx.email]
            );
            if (existing.rows.length > 0) {
              return sendJson(res, { success: true, message: 'Owner StaffProfile already exists', profile_id: existing.rows[0].id });
            }
            // Create owner StaffProfile directly in the dedicated table
            const { randomUUID } = await import('node:crypto');
            const profileId = randomUUID();
            await pool.query(
              `INSERT INTO staff_profiles (id, company_id, user_email, is_administrator, is_active, role_id, created_at, updated_at)
               VALUES ($1, $2, $3, true, true, 'admin', NOW(), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [profileId, company_id, ctx.email]
            );
            console.log(`[Setup] Created owner StaffProfile ${profileId} for ${ctx.email} in child company ${company_id}`);
            return sendJson(res, { success: true, profile_id: profileId });
          }

          if (urlPath === '/api/local/email-provider-status' && req.method === 'GET') {
            const { getEmailProviderStatusPublic } = nodeRequire('./lib/emailProviderHealth.cjs');
            const status = await getEmailProviderStatusPublic();
            return sendJson(res, { success: true, ...status });
          }

          if (urlPath === '/api/local/health' && req.method === 'GET') {
            const pool = getPool();
            const result = await pool.query('SELECT NOW() as time, COUNT(*) as tables FROM information_schema.tables WHERE table_schema = $1', ['public']);
            return sendJson(res, {
              success: true,
              database: 'connected',
              time: result.rows[0].time,
              tables: parseInt(result.rows[0].tables),
            });
          }

          // ==========================================
          // LEGACY LOCAL CUSTOMERS CRUD (backward compat for LocalCustomers.jsx)
          // ==========================================
          if (urlPath === '/api/local/customers' && req.method === 'GET') {
            const pool = getPool();
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const result = await pool.query(
              'SELECT * FROM customers WHERE company_id = $1 ORDER BY created_at DESC',
              [companyId]
            );
            return sendJson(res, { success: true, customers: result.rows });
          }

          if (urlPath === '/api/local/customers' && req.method === 'POST') {
            const pool = getPool();
            const body = await parseBody(req);
            const { company_id, name, company_name, customer_type, email, phone, phone_2, street, city, state, zip, website, source, referral_source, custom_source, notes, group_name, assigned_to, assigned_to_users, tags, insurance_company, adjuster_name, adjuster_phone, is_active } = body;
            if (!company_id || !name) return sendError(res, 'company_id and name are required', 400);
            // ── Server-side entity count limit gate (legacy customers route) ──
            // LOCKSTEP: same check in db/prod-db.cjs; keep in sync.
            {
              const limitCheck = await checkEntityCreationLimit(pool, 'customers', company_id, false);
              if (!limitCheck.allowed) return sendError(res, limitCheck.error, 403);
            }
            const id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const fullAddress = [street, city, state, zip].filter(Boolean).join(', ');
            const result = await pool.query(
              `INSERT INTO customers (id, company_id, name, company_name, customer_type, email, phone, phone_2, street, city, state, zip, address, website, source, referral_source, custom_source, notes, group_name, assigned_to, assigned_to_users, tags, insurance_company, adjuster_name, adjuster_phone, is_active, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW(),NOW()) RETURNING *`,
              [id, company_id, name, company_name || '', customer_type || 'residential', email || '', phone || '', phone_2 || '', street || '', city || '', state || '', zip || '', fullAddress, website || '', source || 'other', referral_source || '', custom_source || '', notes || '', group_name || '', assigned_to || '', JSON.stringify(assigned_to_users || []), JSON.stringify(tags || []), insurance_company || '', adjuster_name || '', adjuster_phone || '', is_active !== false]
            );
            const newCustomer = result.rows[0];
            // Fire workflow trigger for new customer — async, non-blocking
            setImmediate(() => {
              functionHandlers.autoTriggerWorkflowsFromMutation({
                mutation_type: 'create',
                entity_type: 'Customer',
                entity_id: newCustomer.id,
                entity_data: newCustomer,
                company_id,
              }).catch(e => console.error('[customers POST] Workflow trigger failed:', e.message));
            });
            return sendJson(res, { success: true, customer: newCustomer }, 201);
          }

          const customerIdMatch = urlPath.match(/^\/api\/local\/customers\/([^/]+)$/);
          if (customerIdMatch && req.method === 'GET') {
            const pool = getPool();
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const result = await pool.query('SELECT * FROM customers WHERE id = $1 AND company_id = $2', [customerIdMatch[1], companyId]);
            if (result.rows.length === 0) return sendError(res, 'Customer not found', 404);
            return sendJson(res, { success: true, customer: result.rows[0] });
          }

          if (customerIdMatch && req.method === 'PUT') {
            const pool = getPool();
            const body = await parseBody(req);
            const custId = customerIdMatch[1];
            const companyId = body.company_id || query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const scalarFields = ['name','company_name','customer_type','email','phone','phone_2','street','city','state','zip','website','source','referral_source','custom_source','notes','group_name','assigned_to','insurance_company','adjuster_name','adjuster_phone','is_active'];
            const jsonFields = ['assigned_to_users','tags'];
            const updates = [];
            const values = [];
            let idx = 1;
            for (const f of scalarFields) {
              if (body[f] !== undefined) {
                updates.push(`${f} = $${idx}`);
                values.push(body[f]);
                idx++;
              }
            }
            for (const f of jsonFields) {
              if (body[f] !== undefined) {
                updates.push(`${f} = $${idx}`);
                values.push(JSON.stringify(body[f]));
                idx++;
              }
            }
            if (updates.length === 0) return sendError(res, 'No fields to update', 400);
            if (body.street !== undefined || body.city !== undefined || body.state !== undefined || body.zip !== undefined) {
              const existing = (await pool.query('SELECT street, city, state, zip FROM customers WHERE id = $1 AND company_id = $2', [custId, companyId])).rows[0] || {};
              const newAddr = [body.street ?? existing.street, body.city ?? existing.city, body.state ?? existing.state, body.zip ?? existing.zip].filter(Boolean).join(', ');
              updates.push(`address = $${idx}`);
              values.push(newAddr);
              idx++;
            }
            updates.push(`updated_at = $${idx}`);
            values.push(new Date());
            idx++;
            values.push(custId);
            values.push(companyId);
            const result = await pool.query(
              `UPDATE customers SET ${updates.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1} RETURNING *`,
              values
            );
            if (result.rows.length === 0) return sendError(res, 'Customer not found', 404);
            return sendJson(res, { success: true, customer: result.rows[0] });
          }

          if (customerIdMatch && req.method === 'DELETE') {
            const pool = getPool();
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);
            const result = await pool.query('DELETE FROM customers WHERE id = $1 AND company_id = $2 RETURNING id', [customerIdMatch[1], companyId]);
            if (result.rows.length === 0) return sendError(res, 'Customer not found', 404);
            return sendJson(res, { success: true, deleted: true });
          }

          // ==========================================
          // REP PERFORMANCE TEAM SUMMARY
          // GET /api/local/rep-performance-summary?company_id=X&period=current_month
          // Returns pre-aggregated per-rep stats for Team Overview — avoids
          // loading thousands of raw records client-side and aggregating them
          // in the browser for every rep × every entity type.
          // ==========================================
          if (urlPath === '/api/local/rep-performance-summary' && req.method === 'GET') {
            const pool = getPool();
            const companyId = query.company_id;
            if (!companyId) return sendError(res, 'company_id required', 400);

            const period = query.period || 'all_time';
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
            if (query.start_date) startDate = new Date(query.start_date);
            if (query.end_date) endDate = new Date(query.end_date);
            const isAllTimePeriod = period === 'all_time';
            // Full ISO for created_at / payment_date (TIMESTAMP columns, exact comparison safe).
            const startIso = startDate.toISOString();
            const endIso = endDate.toISOString();
            // Date-only for issue_date (TEXT column storing YYYY-MM-DD or YYYY-MM-DDTHH…).
            // Using SUBSTRING(issue_date,1,10) in SQL normalises both formats.
            const startDateOnly = startDate.toISOString().slice(0, 10);
            const endDateOnly = endDate.toISOString().slice(0, 10);

            const staffRes = await pool.query(
              `SELECT user_email, full_name, avatar_url, commission_rate FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL ORDER BY full_name`,
              [companyId]
            );
            if (!staffRes.rows.length) return sendJson(res, { success: true, rows: [] });

            const [leadsRes, custRes, commRes, periodInvRes, allInvRes, payRes] = await Promise.all([
              isAllTimePeriod
                ? pool.query(`SELECT id, assigned_to, assigned_to_users, status FROM leads WHERE company_id = $1`, [companyId])
                : pool.query(`SELECT id, assigned_to, assigned_to_users, status FROM leads WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`, [companyId, startIso, endIso]),
              isAllTimePeriod
                ? pool.query(`SELECT id, assigned_to, assigned_to_users FROM customers WHERE company_id = $1`, [companyId])
                : pool.query(`SELECT id, assigned_to, assigned_to_users FROM customers WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`, [companyId, startIso, endIso]),
              isAllTimePeriod
                ? pool.query(`SELECT id, data->>'assigned_to' AS assigned_to, created_by, lead_id, customer_id FROM communications WHERE company_id = $1`, [companyId])
                : pool.query(`SELECT id, data->>'assigned_to' AS assigned_to, created_by, lead_id, customer_id FROM communications WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3`, [companyId, startIso, endIso]),
              isAllTimePeriod
                ? pool.query(`SELECT id, total_amount, amount, sale_agent, created_by, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`, [companyId])
                : pool.query(`SELECT id, total_amount, amount, sale_agent, created_by, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid' AND SUBSTRING(issue_date, 1, 10) >= $2 AND SUBSTRING(issue_date, 1, 10) <= $3`, [companyId, startDateOnly, endDateOnly]),
              pool.query(`SELECT id, sale_agent, created_by, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`, [companyId]),
              isAllTimePeriod
                ? pool.query(`SELECT amount, invoice_id FROM payments WHERE company_id = $1`, [companyId])
                : pool.query(`SELECT amount, invoice_id FROM payments WHERE company_id = $1 AND payment_date >= $2 AND payment_date <= $3`, [companyId, startIso, endIso]),
            ]);

            const payByInvId = {};
            for (const p of payRes.rows) {
              if (p.invoice_id) payByInvId[p.invoice_id] = (payByInvId[p.invoice_id] || 0) + parseFloat(p.amount || 0);
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
            return sendJson(res, { success: true, rows });
          }

          // ── Presence tracking ──────────────────────────────────────────────
          if (urlPath === '/api/local/presence' && req.method === 'POST') {
            const pool = getPool();
            const body = await parseBody(req);
            const { company_id, user_email, user_name, page, page_label } = body;
            if (!company_id || !user_email) return sendError(res, 'company_id and user_email required', 400);
            const existing = await pool.query(
              `SELECT id FROM generic_entities WHERE entity_type = 'UserPresence' AND company_id = $1 AND data->>'user_email' = $2 LIMIT 1`,
              [company_id, user_email]
            );
            if (existing.rows.length > 0) {
              await pool.query(
                `UPDATE generic_entities SET data = $1::jsonb, updated_date = NOW() WHERE id = $2`,
                [JSON.stringify({ user_email, user_name: user_name || user_email, page, page_label, last_seen: new Date().toISOString() }), existing.rows[0].id]
              );
            } else {
              const presId = `presence_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              await pool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'UserPresence', $2, $3, NOW(), NOW())`,
                [presId, company_id, JSON.stringify({ user_email, user_name: user_name || user_email, page, page_label, last_seen: new Date().toISOString() })]
              );
            }
            return sendJson(res, { success: true });
          }

          if (urlPath === '/api/local/presence' && req.method === 'GET') {
            const pool = getPool();
            const company_id = query.company_id;
            if (!company_id) return sendError(res, 'company_id required', 400);
            const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const result = await pool.query(
              `SELECT id, data, updated_date FROM generic_entities WHERE entity_type = 'UserPresence' AND company_id = $1 AND (data->>'last_seen') > $2 ORDER BY updated_date DESC`,
              [company_id, cutoff]
            );
            return sendJson(res, { success: true, users: result.rows.map(r => ({ id: r.id, ...r.data, updated_date: r.updated_date })) });
          }
          // ── End presence tracking ───────────────────────────────────────────

          return sendError(res, 'Not found', 404);
        } catch (err) {
          console.error('[DB Plugin] Error:', err.message);
          return sendError(res, err.message, 500);
        }
      });
    }
  };
}
