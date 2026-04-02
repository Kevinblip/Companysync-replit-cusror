import { getPool } from './schema.js';

const ENTITY_MAP = {
  leads: { fields: ['name', 'email', 'phone', 'address', 'status', 'source', 'assigned_to', 'service_needed', 'lead_score', 'notes'] },
  customers: { fields: ['name', 'email', 'phone', 'address', 'status', 'total_revenue'] },
  estimates: { fields: ['customer_id', 'customer_name', 'title', 'status', 'total_amount'] },
  invoices: { fields: ['customer_id', 'customer_name', 'invoice_number', 'status', 'total_amount', 'amount_paid', 'due_date'] },
  payments: { fields: ['invoice_id', 'customer_name', 'amount', 'payment_method', 'payment_date'] },
  projects: { fields: ['customer_id', 'customer_name', 'title', 'status', 'start_date', 'end_date', 'total_value'] },
  tasks: { fields: ['title', 'status', 'priority', 'assigned_to', 'due_date', 'related_to'] },
  calendar_events: { fields: ['title', 'event_type', 'start_time', 'end_time', 'location', 'attendees'] },
  communications: { fields: ['type', 'direction', 'contact_name', 'contact_phone', 'contact_email', 'subject', 'body', 'status'] },
  staff_profiles: { fields: ['name', 'email', 'role', 'phone', 'cell_phone', 'call_routing_mode', 'availability_status', 'twilio_number'] },
  companies: { fields: ['name', 'phone', 'email', 'address', 'preferred_language', 'subscription_plan'] },
};

function generateId() {
  return 'loc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function mapBase44FieldName(field) {
  const mappings = {
    'full_name': 'name',
    'first_name': 'name',
    'lead_name': 'name',
    'customer_name': 'customer_name',
    'phone_number': 'phone',
    'email_address': 'email',
    'street_address': 'address',
    'lead_status': 'status',
    'lead_source': 'source',
    'service_type': 'service_needed',
    'score': 'lead_score',
    'total': 'total_amount',
    'amount_due': 'total_amount',
    'paid_amount': 'amount_paid',
    'project_name': 'title',
    'task_name': 'title',
    'event_title': 'title',
    'task_status': 'status',
    'project_status': 'status',
    'invoice_status': 'status',
    'estimate_status': 'status',
    'start': 'start_time',
    'end': 'end_time',
    'event_start': 'start_time',
    'event_end': 'end_time',
    'comm_type': 'type',
    'message_direction': 'direction',
    'cell': 'cell_phone',
    'mobile': 'cell_phone',
    'routing_mode': 'call_routing_mode',
    'company_name': 'name',
  };
  return mappings[field] || field;
}

export async function syncEntityBatch(entityType, records, companyId) {
  const pool = getPool();
  const config = ENTITY_MAP[entityType];
  if (!config) {
    console.warn(`[Sync] Unknown entity type: ${entityType}`);
    return { synced: 0, errors: 0 };
  }

  let synced = 0;
  let errors = 0;

  for (const record of records) {
    try {
      const base44Id = record.id || record._id || generateId();
      const localId = generateId();
      const recCompanyId = record.company_id || companyId;

      const fieldValues = {};
      for (const field of config.fields) {
        let value = record[field];
        if (value === undefined) {
          const mapped = Object.entries(record).find(([k]) => mapBase44FieldName(k) === field);
          if (mapped) value = mapped[1];
        }
        if (value !== undefined) fieldValues[field] = value;
      }

      const remainingData = {};
      for (const [k, v] of Object.entries(record)) {
        if (k !== 'id' && k !== '_id' && k !== 'company_id' && !config.fields.includes(k)) {
          remainingData[k] = v;
        }
      }

      const companyField = entityType === 'companies' ? '' : ', company_id';
      const companyPlaceholder = entityType === 'companies' ? '' : `, $3`;

      if (entityType === 'companies') {
        const cols = Object.keys(fieldValues);
        const vals = Object.values(fieldValues);
        const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
        const colStr = cols.join(', ');
        const placeholders = cols.map((_, i) => `$${i + 3}`).join(', ');

        await pool.query(
          `INSERT INTO ${entityType} (id, base44_id, ${colStr}, data, synced_at)
           VALUES ($1, $2, ${placeholders}, $${cols.length + 3}, NOW())
           ON CONFLICT (base44_id) DO UPDATE SET
             ${setClause}, data = $${cols.length + 3}, synced_at = NOW()`,
          [localId, base44Id, ...vals, JSON.stringify(remainingData)]
        );
      } else {
        const cols = Object.keys(fieldValues);
        const vals = Object.values(fieldValues);
        const setClause = cols.map((c, i) => `${c} = $${i + 4}`).join(', ');
        const colStr = cols.join(', ');
        const placeholders = cols.map((_, i) => `$${i + 4}`).join(', ');

        await pool.query(
          `INSERT INTO ${entityType} (id, base44_id, company_id, ${colStr}, data, synced_at)
           VALUES ($1, $2, $3, ${placeholders}, $${cols.length + 4}, NOW())
           ON CONFLICT (base44_id) DO UPDATE SET
             company_id = $3, ${setClause}, data = $${cols.length + 4}, synced_at = NOW()`,
          [localId, base44Id, recCompanyId, ...vals, JSON.stringify(remainingData)]
        );
      }

      synced++;
    } catch (err) {
      errors++;
      console.error(`[Sync] Error syncing ${entityType} record:`, err.message);
    }
  }

  await pool.query(
    `INSERT INTO sync_status (entity_type, last_synced_at, record_count, status)
     VALUES ($1, NOW(), $2, 'completed')
     ON CONFLICT (entity_type) DO UPDATE SET
       last_synced_at = NOW(), record_count = $2, status = 'completed', error = NULL`,
    [entityType, synced]
  );

  console.log(`[Sync] ${entityType}: ${synced} synced, ${errors} errors`);
  return { synced, errors };
}

export async function syncCallRoutingCache(records) {
  const pool = getPool();
  let synced = 0;

  for (const record of records) {
    try {
      const phone = normalizePhoneForDB(record.phone_number || record.twilio_phone);
      if (!phone) continue;

      await pool.query(
        `INSERT INTO call_routing_cache (phone_number, company_id, company_name, assistant_name, routing_mode, cell_phone, rep_name, rep_email, twilio_sid, twilio_token, twilio_phone, availability_status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (phone_number) DO UPDATE SET
           company_id = $2, company_name = $3, assistant_name = $4, routing_mode = $5,
           cell_phone = $6, rep_name = $7, rep_email = $8, twilio_sid = $9,
           twilio_token = $10, twilio_phone = $11, availability_status = $12, updated_at = NOW()`,
        [
          phone, record.company_id, record.company_name || '',
          record.assistant_name || 'Sarah', record.routing_mode || 'sarah_answers',
          record.cell_phone || '', record.rep_name || '', record.rep_email || '',
          record.twilio_sid || '', record.twilio_token || '', record.twilio_phone || '',
          record.availability_status || 'available'
        ]
      );
      synced++;
    } catch (err) {
      console.error('[Sync] Call routing cache error:', err.message);
    }
  }

  return { synced };
}

function normalizePhoneForDB(phone) {
  if (!phone) return '';
  let clean = phone.replace(/[^\d+]/g, '');
  if (clean.length === 10) clean = '+1' + clean;
  else if (clean.length === 11 && clean.startsWith('1')) clean = '+' + clean;
  else if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

export async function getSyncStatus() {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM sync_status ORDER BY entity_type');
  return result.rows;
}
