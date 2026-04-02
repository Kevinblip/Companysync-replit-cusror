import { initDatabase, getPool } from './db/schema.js';
import { syncEntityBatch, syncCallRoutingCache, getSyncStatus } from './db/sync.js';
import { getDashboardData, getEntityList, getCallRouting, getStaffByTwilioNumber, getReportingData } from './db/queries.js';
import { notifyAdmins, getEntityNotificationConfig } from './vite-notification-helper.js';
import { functionHandlers } from './vite-functions-plugin.js';

async function sendViaResend({ to, subject, html, from }) {
  const resendKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromAddr = from || process.env.EMAIL_FROM || 'CompanySync <noreply@resend.dev>';
  if (smtpHost && smtpUser && smtpPass) {
    const { default: nodemailer } = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost, port: parseInt(process.env.SMTP_PORT || '587'), secure: parseInt(process.env.SMTP_PORT || '587') === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transporter.sendMail({ from: fromAddr, to, subject, html });
    console.log(`[Email] Sent via SMTP to ${to}: ${subject}`);
    return;
  }
  if (!resendKey) { console.warn('[Email] No email provider configured — skipping'); return; }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddr, to: [to], subject, html })
  });
  const data = await resp.json();
  if (data.id) {
    console.log(`[Email] Sent via Resend to ${to}: ${subject} (${data.id})`);
  } else {
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
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

    const isDirectCol = !tableColumns || tableColumns.has(key);
    const colRef = isDirectCol ? `"${key}"` : `data->>'${key}'`;

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
          clauses.push(`"${key}" > $${idx}`);
          values.push(val.$gt);
        } else {
          clauses.push(`(data->>'${key}')::numeric > $${idx}`);
          values.push(Number(val.$gt));
        }
        idx++;
      }
      if (val.$gte !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${key}" >= $${idx}`);
          values.push(val.$gte);
        } else {
          clauses.push(`(data->>'${key}')::numeric >= $${idx}`);
          values.push(Number(val.$gte));
        }
        idx++;
      }
      if (val.$lt !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${key}" < $${idx}`);
          values.push(val.$lt);
        } else {
          clauses.push(`(data->>'${key}')::numeric < $${idx}`);
          values.push(Number(val.$lt));
        }
        idx++;
      }
      if (val.$lte !== undefined) {
        if (isDirectCol) {
          clauses.push(`"${key}" <= $${idx}`);
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

    for (const [key, val] of Object.entries(data)) {
      if (key === 'id' || key === 'created_date' || key === 'created_at') continue;
      if (tableColumns.has(key) && key !== 'data') {
        if (usedColumns.has(key)) continue; // deduplicate
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
      } else if (key !== 'data') {
        extraData[key] = val;
      }
    }

    if (Object.keys(extraData).length > 0 && tableColumns.has('data') && !usedColumns.has('data')) {
      usedColumns.add('data');
      updates.push(`data = COALESCE(data, '{}')::jsonb || $${idx}::jsonb`);
      values.push(JSON.stringify(extraData));
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
async function backfillOrphanedRecords(pool, companyId) {
  const companyCount = await pool.query('SELECT COUNT(*) as cnt FROM companies WHERE (is_deleted IS NULL OR is_deleted = false)');
  const totalCompanies = parseInt(companyCount.rows[0].cnt);
  if (totalCompanies > 1) {
    if (!_backfillSkipLogged) {
      console.log(`[Backfill] Skipping orphan backfill - ${totalCompanies} companies exist, cannot safely assign orphaned records`);
      _backfillSkipLogged = true;
    }
    return;
  }
  const tables = ['leads', 'customers', 'estimates', 'invoices', 'payments', 'projects', 'tasks', 'calendar_events', 'communications'];
  let totalFixed = 0;
  for (const table of tables) {
    try {
      const result = await pool.query(
        `UPDATE ${table} SET company_id = $1 WHERE company_id IS NULL`,
        [companyId]
      );
      if (result.rowCount > 0) {
        console.log(`[Backfill] Assigned ${result.rowCount} orphaned ${table} records to company ${companyId}`);
        totalFixed += result.rowCount;
      }
    } catch (err) {
      console.error(`[Backfill] Error on ${table}:`, err.message);
    }
  }
  try {
    const result = await pool.query(
      `UPDATE generic_entities SET company_id = $1 WHERE company_id IS NULL`,
      [companyId]
    );
    if (result.rowCount > 0) {
      console.log(`[Backfill] Assigned ${result.rowCount} orphaned generic_entities to company ${companyId}`);
      totalFixed += result.rowCount;
    }
  } catch (err) {
    console.error('[Backfill] Error on generic_entities:', err.message);
  }
  if (totalFixed > 0) console.log(`[Backfill] Total fixed: ${totalFixed} orphaned records`);
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

  return {
    name: 'local-db-api',
    async configureServer(server) {
      try {
        await initDatabase();
        dbReady = true;
        console.log('[DB Plugin] Database ready');

        (async () => {
          try {
            const p = getPool();
            const companiesResult = await p.query(
              `SELECT id, data->>'created_by' as created_by FROM generic_entities WHERE entity_type = 'Company' AND COALESCE(data->>'is_deleted', 'false') != 'true'`
            );
            let totalCleared = 0;
            for (const company of companiesResult.rows) {
              if (!company.created_by) continue;
              const staffResult = await p.query(
                `SELECT id, data->>'user_email' as user_email, data->>'full_name' as full_name, data->>'is_administrator' as is_administrator 
                 FROM generic_entities WHERE entity_type = 'StaffProfile' AND company_id = $1 AND (data->>'is_administrator')::text = 'true'`,
                [company.id]
              );
              for (const staff of staffResult.rows) {
                const staffEmail = staff.user_email || '';
                if (staffEmail && staffEmail !== company.created_by) {
                  await p.query(
                    `UPDATE generic_entities SET data = jsonb_set(data, '{is_administrator}', 'false'), updated_date = NOW() WHERE id = $1`,
                    [staff.id]
                  );
                  totalCleared++;
                  console.log(`[Security] Cleared is_administrator from non-owner: ${staff.full_name || staffEmail} (company: ${company.id})`);
                }
              }
            }
            if (totalCleared > 0) {
              console.log(`[Security] Server startup: cleared is_administrator flag from ${totalCleared} non-owner staff profile(s)`);
            } else {
              console.log('[Security] Server startup: no non-owner admin flags found');
            }

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
        })();
      } catch (err) {
        console.error('[DB Plugin] Database init failed:', err.message);
      }

      server.middlewares.use(async (req, res, next) => {
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

        if (!req.url.startsWith('/api/local/')) return next();

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          });
          res.end();
          return;
        }

        if (!dbReady) {
          return sendError(res, 'Database not ready', 503);
        }

        const urlPath = req.url.split('?')[0];
        const query = parseQuery(req.url);

        try {
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

            if (req.method === 'GET') {
              const filters = {};
              for (const [k, v] of Object.entries(query)) {
                if (k === '_sort' || k === '_limit' || k === '_offset') continue;
                try {
                  filters[k] = JSON.parse(v);
                } catch {
                  filters[k] = v;
                }
              }
              if (entityType === 'signing_sessions') {
                console.log(`[Entity GET] signing_sessions filters:`, JSON.stringify(filters));
              }
              const sort = query._sort || '-created_date';
              const limit = parseInt(query._limit) || 1000;
              const results = await genericFilter(pool, entityType, filters, sort, limit);
              return sendJson(res, results);
            }

            if (req.method === 'POST') {
              const body = await parseBody(req);

              if (Array.isArray(body)) {
                const results = await genericBulkCreate(pool, entityType, body);
                return sendJson(res, results, 201);
              }

              const dupCheck = await checkDuplicateBeforeCreate(pool, entityType, body);
              if (dupCheck) {
                return sendJson(res, { error: dupCheck.message, duplicate: true, existing_id: dupCheck.existingId }, 409);
              }

              const created = await genericCreate(pool, entityType, body);

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
              }

              return sendJson(res, created, 201);
            }
          }

          if (entitySingleMatch) {
            const pool = getPool();
            const sdkName = entitySingleMatch[1];
            const entityType = sdkNameToEntityType(sdkName);
            const recordId = entitySingleMatch[2];

            if (req.method === 'GET') {
              const record = await genericGet(pool, entityType, recordId);
              if (!record) return sendError(res, 'Not found', 404);
              return sendJson(res, record);
            }

            if (req.method === 'PUT' || req.method === 'PATCH') {
              const body = await parseBody(req);
              const updated = await genericUpdate(pool, entityType, recordId, body);

              // Fire workflow automations on update — catches status changes like invoice_paid, estimate_accepted
              if (updated && updated.company_id) {
                functionHandlers.autoTriggerWorkflowsFromMutation({
                  entity_type: sdkName,
                  mutation_type: 'update',
                  entity_id: recordId,
                  entity_data: updated,
                  company_id: updated.company_id,
                }).catch(e => console.warn(`[DB] Workflow trigger failed for ${sdkName} update:`, e.message));
              }

              return sendJson(res, updated);
            }

            if (req.method === 'DELETE') {
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
            const body = await parseBody(req);
            const { email, name } = body;
            if (!email) return sendError(res, 'email required', 400);
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
              `INSERT INTO companies (id, name, company_name, created_by, email, preferred_language, subscription_plan, is_deleted, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'en', 'professional', false, NOW(), NOW())`,
              [companyId, companyName, companyName, email, email]
            );

            const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await pool.query(
              `INSERT INTO staff_profiles (id, company_id, name, full_name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, true, true, NOW(), NOW())`,
              [staffId, companyId, displayName, displayName, email, email]
            );

            backfillOrphanedRecords(pool, companyId).catch(err => console.error('[Backfill] Error:', err.message));
            seedDefaultTemplates(pool, companyId, companyName).catch(err => console.error('[Templates] Error seeding on provision:', err.message));
            functionHandlers.setupDefaultWorkflows({ companyId }).catch(err => console.error('[Workflows] Error setting up default workflows on provision:', err.message));

            const newCompany = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
            console.log(`[Auto-Provision] Created company "${companyName}" (${companyId}) and staff profile for ${email}`);

            // Send welcome email to new company + admin notification (fire and forget)
            sendNewCompanyEmails({ email, displayName, companyName, companyId }).catch(err =>
              console.error('[Auto-Provision] Email notification error:', err.message)
            );

            return sendJson(res, { company: newCompany.rows[0], staffProfile: { id: staffId }, created: true });
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
