import { getPool } from './schema.js';

export async function getDashboardData(companyId) {
  const pool = getPool();

  const [
    leadStats,
    invoiceStats,
    customerCount,
    estimateStats,
    projectStats,
    taskStats,
    recentLeads,
    recentPayments,
    upcomingEvents,
    recentComms,
    staffList
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'contacted') as contacted_count,
        COUNT(*) FILTER (WHERE status = 'qualified') as qualified_count,
        COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') as won_count,
        COUNT(*) FILTER (WHERE status = 'lost') as lost_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30_days,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last_7_days
      FROM leads WHERE company_id = $1
    `, [companyId]),

    pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
        COUNT(*) FILTER (WHERE status = 'sent' OR status = 'pending') as outstanding_count,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count,
        COALESCE(SUM(total_amount), 0) as total_amount,
        COALESCE(SUM(amount_paid), 0) as total_paid,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'sent' OR status = 'pending' OR status = 'overdue'), 0) as outstanding_amount
      FROM invoices WHERE company_id = $1
    `, [companyId]),

    pool.query('SELECT COUNT(*) as total FROM customers WHERE company_id = $1', [companyId]),

    pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'approved' OR status = 'accepted') as approved_count,
        COALESCE(SUM(total_amount), 0) as total_value,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved' OR status = 'accepted'), 0) as approved_value
      FROM estimates WHERE company_id = $1
    `, [companyId]),

    pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active' OR status = 'in_progress') as active_count,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
        COALESCE(SUM(total_value), 0) as total_value
      FROM projects WHERE company_id = $1
    `, [companyId]),

    pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending' OR status = 'todo') as pending_count,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count,
        COUNT(*) FILTER (WHERE status = 'completed' OR status = 'done') as completed_count,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status != 'completed' AND status != 'done') as overdue_count
      FROM tasks WHERE company_id = $1
    `, [companyId]),

    pool.query(`
      SELECT id, base44_id, name, email, phone, status, source, assigned_to, service_needed, created_at, data
      FROM leads WHERE company_id = $1
      ORDER BY created_at DESC LIMIT 10
    `, [companyId]),

    pool.query(`
      SELECT id, base44_id, customer_name, amount, payment_method, payment_date, data
      FROM payments WHERE company_id = $1
      ORDER BY payment_date DESC LIMIT 10
    `, [companyId]),

    pool.query(`
      SELECT id, base44_id, title, event_type, start_time, end_time, location, data
      FROM calendar_events WHERE company_id = $1 AND start_time >= NOW()
      ORDER BY start_time ASC LIMIT 15
    `, [companyId]),

    pool.query(`
      SELECT id, base44_id, type, direction, contact_name, subject, status, created_at, data
      FROM communications WHERE company_id = $1
      ORDER BY created_at DESC LIMIT 10
    `, [companyId]),

    pool.query(`
      SELECT id, base44_id, name, email, role, phone, availability_status, data
      FROM staff_profiles WHERE company_id = $1
    `, [companyId]),
  ]);

  return {
    leads: {
      stats: leadStats.rows[0],
      recent: recentLeads.rows,
    },
    invoices: {
      stats: invoiceStats.rows[0],
    },
    customers: {
      total: parseInt(customerCount.rows[0].total),
    },
    estimates: {
      stats: estimateStats.rows[0],
    },
    projects: {
      stats: projectStats.rows[0],
    },
    tasks: {
      stats: taskStats.rows[0],
    },
    payments: {
      recent: recentPayments.rows,
    },
    calendar: {
      upcoming: upcomingEvents.rows,
    },
    communications: {
      recent: recentComms.rows,
    },
    staff: staffList.rows,
  };
}

export async function getEntityList(entityType, companyId, { limit = 200, offset = 0, status, sort = 'created_at', order = 'DESC', search } = {}) {
  const pool = getPool();
  const params = [companyId];
  let whereClause = 'WHERE company_id = $1';
  let paramIdx = 2;

  if (status) {
    whereClause += ` AND status = $${paramIdx}`;
    params.push(status);
    paramIdx++;
  }

  if (search) {
    whereClause += ` AND (name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR phone ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  const validTables = ['leads', 'customers', 'estimates', 'invoices', 'payments', 'projects', 'tasks', 'calendar_events', 'communications', 'staff_profiles'];
  if (!validTables.includes(entityType)) {
    throw new Error(`Invalid entity type: ${entityType}`);
  }

  const validSorts = ['created_at', 'updated_at', 'name', 'status', 'total_amount', 'start_time', 'due_date', 'payment_date'];
  const safeSort = validSorts.includes(sort) ? sort : 'created_at';
  const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  params.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM ${entityType} ${whereClause} ORDER BY ${safeSort} ${safeOrder} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    params
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM ${entityType} ${whereClause}`,
    params.slice(0, paramIdx - 1)
  );

  return {
    records: result.rows,
    total: parseInt(countResult.rows[0].total),
    limit,
    offset,
  };
}

export async function getCallRouting(phoneNumber) {
  const pool = getPool();
  const normalized = normalizePhone(phoneNumber);
  const result = await pool.query(
    'SELECT * FROM call_routing_cache WHERE phone_number = $1',
    [normalized]
  );
  if (result.rows[0]) return result.rows[0];

  // Check TwilioSettings: main_phone_number OR available_numbers array
  const twilioLookup = await pool.query(
    `SELECT g.company_id, c.name as company_name, c.created_by as company_owner,
            a.data->>'assistant_name' as assistant_name,
            a.data->>'brand_short_name' as brand_short_name
     FROM generic_entities g
     JOIN companies c ON c.id = g.company_id OR c.base44_id = g.company_id
     LEFT JOIN generic_entities a ON (a.company_id = g.company_id OR a.company_id = c.id) AND a.entity_type = 'AssistantSettings'
     WHERE g.entity_type = 'TwilioSettings'
       AND (
         g.data->>'main_phone_number' = $1
         OR g.data->>'main_phone_number' = $2
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.data->'available_numbers') elem WHERE elem->>'phone_number' = $1 OR elem->>'phone_number' = $2)
       )
     LIMIT 1`,
    [normalized, phoneNumber]
  );
  if (twilioLookup.rows[0]) {
    const tw = twilioLookup.rows[0];
    
    // Try to find the company owner's staff profile to use their routing settings
    let ownerRouting = null;
    if (tw.company_owner) {
      const ownerLookup = await pool.query(
        `SELECT sp.full_name as rep_name, sp.user_email as rep_email,
                sp.cell_phone, sp.call_routing_mode as routing_mode, sp.availability_status
         FROM staff_profiles sp
         WHERE sp.company_id = $1 AND sp.user_email = $2
         LIMIT 1`,
        [tw.company_id, tw.company_owner]
      );
      if (ownerLookup.rows[0]) {
        ownerRouting = ownerLookup.rows[0];
      }
    }
    
    const routingRow = {
      phone_number: normalized,
      company_id: tw.company_id,
      company_name: tw.brand_short_name || tw.company_name || '',
      assistant_name: tw.assistant_name || 'sarah',
      routing_mode: ownerRouting?.routing_mode || 'sarah_answers',
      cell_phone: ownerRouting?.cell_phone || '',
      rep_name: ownerRouting?.rep_name || '',
      rep_email: ownerRouting?.rep_email || '',
      availability_status: ownerRouting?.availability_status || 'available',
    };
    try {
      await pool.query(
        `INSERT INTO call_routing_cache (phone_number, company_id, company_name, assistant_name, routing_mode, cell_phone, rep_name, rep_email, availability_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (phone_number) DO UPDATE SET company_id = $2, company_name = $3, assistant_name = $4, routing_mode = $5, cell_phone = $6, rep_name = $7, rep_email = $8, availability_status = $9`,
        [normalized, routingRow.company_id, routingRow.company_name, routingRow.assistant_name, routingRow.routing_mode, routingRow.cell_phone, routingRow.rep_name, routingRow.rep_email, routingRow.availability_status]
      );
    } catch (e) { /* cache insert is best effort */ }
    return routingRow;
  }

  // Also check staff_profiles.twilio_number directly
  const staffLookup = await pool.query(
    `SELECT sp.company_id, sp.full_name as rep_name, sp.user_email as rep_email,
            sp.cell_phone, sp.call_routing_mode as routing_mode, sp.availability_status,
            COALESCE(a.data->>'brand_short_name', c.name) as company_name,
            COALESCE(a.data->>'assistant_name', 'Sarah') as assistant_name
     FROM staff_profiles sp
     JOIN companies c ON c.id = sp.company_id
     LEFT JOIN generic_entities a ON a.company_id = sp.company_id AND a.entity_type = 'AssistantSettings'
     WHERE sp.twilio_number = $1 OR sp.twilio_number = $2
     LIMIT 1`,
    [normalized, phoneNumber]
  );
  if (staffLookup.rows[0]) {
    const st = staffLookup.rows[0];
    const routingRow = {
      phone_number: normalized,
      company_id: st.company_id,
      company_name: st.company_name || '',
      assistant_name: st.assistant_name || 'sarah',
      routing_mode: st.routing_mode || 'sarah_answers',
      cell_phone: st.cell_phone || '',
      rep_name: st.rep_name || '',
      rep_email: st.rep_email || '',
      availability_status: st.availability_status || 'available',
    };
    try {
      await pool.query(
        `INSERT INTO call_routing_cache (phone_number, company_id, company_name, assistant_name, routing_mode, cell_phone, rep_name, rep_email, availability_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (phone_number) DO UPDATE SET company_id = $2, company_name = $3, assistant_name = $4, routing_mode = $5, cell_phone = $6, rep_name = $7, rep_email = $8, availability_status = $9`,
        [normalized, routingRow.company_id, routingRow.company_name, routingRow.assistant_name, routingRow.routing_mode, routingRow.cell_phone, routingRow.rep_name, routingRow.rep_email, routingRow.availability_status]
      );
    } catch (e) { /* cache insert is best effort */ }
    return routingRow;
  }

  return null;
}

export async function getStaffByTwilioNumber(twilioNumber) {
  const pool = getPool();
  const normalized = normalizePhone(twilioNumber);
  const result = await pool.query(
    'SELECT * FROM staff_profiles WHERE twilio_number = $1 LIMIT 1',
    [normalized]
  );
  return result.rows[0] || null;
}

export async function getReportingData(companyId, reportType) {
  const pool = getPool();

  switch (reportType) {
    case 'revenue': {
      const result = await pool.query(`
        SELECT
          DATE_TRUNC('month', payment_date) as month,
          SUM(amount) as total,
          COUNT(*) as payment_count
        FROM payments
        WHERE company_id = $1 AND payment_date IS NOT NULL
        GROUP BY DATE_TRUNC('month', payment_date)
        ORDER BY month DESC
        LIMIT 12
      `, [companyId]);
      return result.rows;
    }

    case 'ar_aging': {
      const result = await pool.query(`
        SELECT
          customer_name,
          SUM(total_amount - amount_paid) as outstanding,
          MIN(due_date) as oldest_due,
          COUNT(*) as invoice_count,
          SUM(CASE WHEN due_date < NOW() THEN total_amount - amount_paid ELSE 0 END) as overdue_amount,
          SUM(CASE WHEN due_date >= NOW() AND due_date < NOW() + INTERVAL '30 days' THEN total_amount - amount_paid ELSE 0 END) as due_30,
          SUM(CASE WHEN due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days' THEN total_amount - amount_paid ELSE 0 END) as past_30_60,
          SUM(CASE WHEN due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days' THEN total_amount - amount_paid ELSE 0 END) as past_60_90,
          SUM(CASE WHEN due_date < NOW() - INTERVAL '90 days' THEN total_amount - amount_paid ELSE 0 END) as past_90_plus
        FROM invoices
        WHERE company_id = $1 AND status != 'paid' AND total_amount > amount_paid
        GROUP BY customer_name
        ORDER BY outstanding DESC
      `, [companyId]);
      return result.rows;
    }

    case 'lead_conversion': {
      const result = await pool.query(`
        SELECT
          source,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') as converted,
          COUNT(*) FILTER (WHERE status = 'lost') as lost,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') / NULLIF(COUNT(*), 0),
            1
          ) as conversion_rate
        FROM leads
        WHERE company_id = $1
        GROUP BY source
        ORDER BY total DESC
      `, [companyId]);
      return result.rows;
    }

    case 'staff_performance': {
      const result = await pool.query(`
        SELECT
          assigned_to,
          COUNT(*) as total_leads,
          COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') as won,
          COUNT(*) FILTER (WHERE status = 'lost') as lost,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') / NULLIF(COUNT(*), 0),
            1
          ) as win_rate
        FROM leads
        WHERE company_id = $1 AND assigned_to IS NOT NULL
        GROUP BY assigned_to
        ORDER BY total_leads DESC
      `, [companyId]);
      return result.rows;
    }

    default:
      return [];
  }
}

function normalizePhone(phone) {
  if (!phone) return '';
  let clean = phone.replace(/[^\d+]/g, '');
  if (clean.length === 10) clean = '+1' + clean;
  else if (clean.length === 11 && clean.startsWith('1')) clean = '+' + clean;
  else if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}
