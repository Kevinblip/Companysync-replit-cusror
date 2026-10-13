'use strict';

// Shared work-order API. Both the Vite dev server and the production server
// call this module so public-token and tenant-scoping behavior cannot drift.
const crypto = require('crypto');
const tenantGuard = require('./tenantGuard.cjs');

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MONEY_LIMIT_CENTS = 1000000000;
const VALID_STATUSES = new Set(['pending', 'accepted', 'completed', 'approved', 'paid']);

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (overflow) return;
      total += chunk.length;
      if (total > maxBytes) {
        overflow = true;
        req.resume();
        const error = new Error(`Request body too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function normalizeText(value, maxLength = 240) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidPhone(value) {
  return String(value || '').replace(/\D/g, '').length >= 7;
}

function moneyToCents(value) {
  if (typeof value === 'string' && !/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MONEY_LIMIT_CENTS / 100) return null;
  return Math.round((n + Number.EPSILON) * 100);
}

function quantityToMilli(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
  return Math.round(n * 1000);
}

function centsFor(quantityMilli, unitRateCents) {
  return Math.round((quantityMilli * unitRateCents) / 1000);
}

function getRequestPath(req) {
  return new URL(req.url, 'http://localhost').pathname;
}

function mimeFromBuffer(buffer, declared) {
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (isJpeg) return { mime: 'image/jpeg', ext: '.jpg' };
  if (isPng) return { mime: 'image/png', ext: '.png' };
  if (isWebp) return { mime: 'image/webp', ext: '.webp' };
  if (declared && !String(declared).startsWith('image/')) return null;
  return null;
}

async function isCompanyAdministrator(pool, ctx, companyId) {
  if (ctx.isSuperAdmin || ctx.administratorCompanyIds?.has(companyId)) return true;
  const result = await pool.query(
    'SELECT 1 FROM companies WHERE id = $1 AND LOWER(COALESCE(created_by, \'\')) = LOWER($2) LIMIT 1',
    [companyId, ctx.email]
  );
  return result.rows.length > 0;
}

async function getStaffContext(req, pool) {
  const ctx = await tenantGuard.resolveRequestContext(req, pool);
  if (!ctx.authenticated) return { error: [401, 'Unauthorized'] };
  if (ctx.impersonationExpired) return { error: [401, 'Impersonation session expired. Please return to the admin dashboard.'] };
  if (ctx.isImpersonating) return { error: [403, 'Work-order changes are not permitted while impersonating a company.'] };
  return { ctx };
}

async function resolveRateItems(pool, companyId, subcontractorId, suppliedItems) {
  // Backward-compatible call shape for arithmetic tests and any internal callers.
  if (suppliedItems === undefined) {
    suppliedItems = subcontractorId;
    subcontractorId = null;
  }
  if (!Array.isArray(suppliedItems) || suppliedItems.length === 0 || suppliedItems.length > 100) {
    return { error: 'Add at least one labor-rate line item (maximum 100).' };
  }
  const ids = [...new Set(suppliedItems.map((item) => normalizeText(item?.labor_rate_id, 100)).filter(Boolean))];
  if (ids.length !== suppliedItems.length) return { error: 'Every work-order item must have a labor rate.' };
  const rates = await pool.query(
    `SELECT labor_rate.id, labor_rate.name, labor_rate.category, labor_rate.unit, labor_rate.rate_cents,
            subcontractor_rate.custom_rate
       FROM labor_rates labor_rate
       LEFT JOIN subcontractor_rates subcontractor_rate
         ON subcontractor_rate.labor_rate_id = labor_rate.id
        AND subcontractor_rate.company_id = labor_rate.company_id
        AND subcontractor_rate.subcontractor_id = $3
      WHERE labor_rate.company_id = $1 AND labor_rate.is_active = true AND labor_rate.id = ANY($2::text[])`,
    [companyId, ids, subcontractorId]
  );
  if (rates.rows.length !== ids.length) return { error: 'One or more selected labor rates are missing or inactive.' };
  const byId = new Map(rates.rows.map((rate) => [rate.id, rate]));
  let payoutCents = 0;
  const items = [];
  for (const supplied of suppliedItems) {
    const rate = byId.get(normalizeText(supplied.labor_rate_id, 100));
    const quantityMilli = quantityToMilli(supplied.quantity);
    if (!quantityMilli) return { error: `Enter a valid quantity for ${rate?.name || 'each item'}.` };
    const overrideCents = rate.custom_rate === null || rate.custom_rate === undefined
      ? null
      : moneyToCents(String(rate.custom_rate));
    if (overrideCents === null && rate.custom_rate !== null && rate.custom_rate !== undefined) {
      return { error: `The saved custom rate for ${rate.name} is invalid.` };
    }
    const unitRateCents = overrideCents ?? Number(rate.rate_cents);
    const totalCents = centsFor(quantityMilli, unitRateCents);
    if (!Number.isSafeInteger(totalCents) || totalCents > MONEY_LIMIT_CENTS) return { error: 'A line total is too large.' };
    payoutCents += totalCents;
    if (payoutCents > MONEY_LIMIT_CENTS) return { error: 'The total payout is too large.' };
    items.push({
      id: crypto.randomUUID(),
      labor_rate_id: rate.id,
      description: normalizeText(supplied.description, 500) || rate.name,
      unit: rate.unit,
      quantity: quantityMilli / 1000,
      unit_rate_cents: unitRateCents,
      total_cents: totalCents,
    });
  }
  return { items, payoutCents };
}

async function getWorkOrder(pool, id, token = null) {
  const result = await pool.query(
    `SELECT w.*, p.title AS project_title, p.address AS project_address,
            s.data->>'name' AS subcontractor_name, s.data->>'phone' AS subcontractor_phone,
            s.data->>'email' AS subcontractor_email
       FROM work_orders w
       JOIN projects p ON p.id = w.project_id AND p.company_id = w.company_id
       LEFT JOIN generic_entities s ON s.id = w.subcontractor_id
           AND s.company_id = w.company_id AND s.entity_type = 'Subcontractor'
      WHERE w.id = $1 ${token ? 'AND w.access_token = $2' : ''} LIMIT 1`,
    token ? [id, token] : [id]
  );
  return result.rows[0] || null;
}

async function decorateWorkOrder(pool, workOrder, includePhotos = true) {
  if (!workOrder) return null;
  const items = await pool.query(
    `SELECT id, labor_rate_id, description, unit, quantity, unit_rate_cents, total_cents
       FROM work_order_items WHERE work_order_id = $1 ORDER BY created_at, id`,
    [workOrder.id]
  );
  let photos = [];
  if (includePhotos) {
    const photoResult = await pool.query(
      `SELECT id, file_url, original_filename, created_at
         FROM work_order_completion_photos WHERE work_order_id = $1 ORDER BY created_at, id`,
      [workOrder.id]
    );
    photos = photoResult.rows;
  }
  return {
    ...workOrder,
    payout_cents: Number(workOrder.payout_cents),
    items: items.rows.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unit_rate_cents: Number(item.unit_rate_cents),
      total_cents: Number(item.total_cents),
    })),
    photos,
  };
}

async function handlePublicRoute(req, res, pool, pathname, url) {
  if (pathname === '/api/public/work-orders' && req.method === 'GET') {
    const token = normalizeText(url.searchParams.get('token'), 200);
    if (!token) { sendJson(res, 400, { error: 'Work-order link is missing.' }); return true; }
    const result = await pool.query(
      `SELECT w.*, p.title AS project_title, p.address AS project_address,
              s.data->>'name' AS subcontractor_name
         FROM work_orders w
         JOIN projects p ON p.id = w.project_id AND p.company_id = w.company_id
         LEFT JOIN generic_entities s ON s.id = w.subcontractor_id AND s.company_id = w.company_id
             AND s.entity_type = 'Subcontractor'
        WHERE w.access_token = $1 LIMIT 1`,
      [token]
    );
    if (!result.rows.length) { sendJson(res, 404, { error: 'This work-order link is invalid or expired.' }); return true; }
    const workOrder = await decorateWorkOrder(pool, result.rows[0]);
    sendJson(res, 200, { success: true, work_order: workOrder });
    return true;
  }

  const action = pathname.match(/^\/api\/public\/work-orders\/([^/]+)\/(accept|photos|complete)$/);
  if (!action || req.method !== 'POST') return false;
  const [_, id, operation] = action;
  const body = await readJson(req, operation === 'photos' ? 12 * 1024 * 1024 : 1024 * 1024);
  const token = normalizeText(body.token, 200);
  if (!token) { sendJson(res, 401, { error: 'Work-order link is missing.' }); return true; }
  const order = await getWorkOrder(pool, id, token);
  if (!order) { sendJson(res, 404, { error: 'This work order is no longer available.' }); return true; }

  if (operation === 'accept') {
    const updated = await pool.query(
      `UPDATE work_orders SET status = 'accepted', accepted_at = COALESCE(accepted_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND access_token = $2 AND status = 'pending' RETURNING id`,
      [id, token]
    );
    if (!updated.rows.length && order.status !== 'accepted') {
      sendJson(res, 409, { error: `This work order cannot be accepted while it is ${order.status}.` });
      return true;
    }
    sendJson(res, 200, { success: true, status: 'accepted' });
    return true;
  }

  if (operation === 'photos') {
    if (!['pending', 'accepted'].includes(order.status)) {
      sendJson(res, 409, { error: 'Photos can only be added before submission.' });
      return true;
    }
    const rawBase64 = typeof body.photo_base64 === 'string' ? body.photo_base64.replace(/^data:[^;]+;base64,/, '') : '';
    if (!rawBase64 || rawBase64.length > 16 * 1024 * 1024) { sendJson(res, 400, { error: 'A valid photo is required.' }); return true; }
    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) { sendJson(res, 400, { error: 'Photo must be smaller than 8 MB.' }); return true; }
    const image = mimeFromBuffer(buffer, body.mime_type);
    if (!image) { sendJson(res, 400, { error: 'Only JPEG, PNG, and WebP images are accepted.' }); return true; }
    const filename = `work-order-${order.id}-${crypto.randomUUID()}${image.ext}`;
    try {
      const storage = require('../db/object-storage.cjs');
      await storage.uploadToObjectStorage(filename, buffer, image.mime);
    } catch (error) {
      console.error('[WorkOrders] completion-photo upload failed:', error.message);
      sendJson(res, 503, { error: 'Photo storage is temporarily unavailable. Please try again.' });
      return true;
    }
    const photoId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO work_order_completion_photos
        (id, work_order_id, company_id, file_url, original_filename, mime_type, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [photoId, order.id, order.company_id, `/uploads/${filename}`, normalizeText(body.filename, 255) || filename, image.mime, buffer.length]
    );
    sendJson(res, 201, { success: true, photo: { id: photoId, file_url: `/uploads/${filename}` } });
    return true;
  }

  if (order.status === 'completed') { sendJson(res, 409, { error: 'This work order was already submitted for payment.' }); return true; }
  if (order.status !== 'accepted') { sendJson(res, 409, { error: 'Accept the work order before submitting it for payment.' }); return true; }
  const photoCheck = await pool.query('SELECT 1 FROM work_order_completion_photos WHERE work_order_id = $1 LIMIT 1', [order.id]);
  if (!photoCheck.rows.length) { sendJson(res, 400, { error: 'Add at least one completion photo before submitting for payment.' }); return true; }
  const completionNotes = normalizeText(body.completion_notes, 3000);
  const updated = await pool.query(
    `UPDATE work_orders SET status = 'completed', completion_notes = $3, completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND access_token = $2 AND status = 'accepted' RETURNING id`,
    [order.id, token, completionNotes || null]
  );
  if (!updated.rows.length) { sendJson(res, 409, { error: 'This work order was updated. Refresh the page and try again.' }); return true; }
  sendJson(res, 200, { success: true, status: 'completed' });
  return true;
}

async function handleStaffRoute(req, res, pool, pathname, url, { sendSMS, sendEmail, getAppUrl }) {
  const ctxResult = await getStaffContext(req, pool);
  if (ctxResult.error) { sendJson(res, ctxResult.error[0], { error: ctxResult.error[1] }); return true; }
  const ctx = ctxResult.ctx;
  const requestedCompany = normalizeText(url.searchParams.get('company_id'), 100);
  const companyId = requestedCompany || [...ctx.allowedCompanyIds][0];
  if (!companyId || (!ctx.isSuperAdmin && !ctx.allowedCompanyIds.has(companyId))) {
    sendJson(res, 403, { error: 'You do not have access to this company.' });
    return true;
  }

  const rateMatch = pathname.match(/^\/api\/labor-rates(?:\/([^/]+))?$/);
  if (rateMatch) {
    const rateId = rateMatch[1];
    if (req.method === 'GET' && !rateId) {
      const result = await pool.query(
        `SELECT id, name, category, unit, rate_cents, is_active, created_at, updated_at
           FROM labor_rates WHERE company_id = $1 ORDER BY is_active DESC, category, name`,
        [companyId]
      );
      sendJson(res, 200, { labor_rates: result.rows.map((rate) => ({ ...rate, rate_cents: Number(rate.rate_cents) })) });
      return true;
    }
    if (!['POST', 'PATCH'].includes(req.method)) { sendJson(res, 405, { error: 'Method not allowed.' }); return true; }
    if (!(await isCompanyAdministrator(pool, ctx, companyId))) { sendJson(res, 403, { error: 'Only company administrators can manage labor rates.' }); return true; }
    const body = await readJson(req);
    const name = normalizeText(body.name, 160);
    const category = normalizeText(body.category, 100);
    const unit = normalizeText(body.unit, 40);
    const rateCents = moneyToCents(body.rate);
    if (!name || !unit || rateCents === null) { sendJson(res, 400, { error: 'Name, unit, and a valid non-negative rate are required.' }); return true; }
    if (req.method === 'POST') {
      const id = crypto.randomUUID();
      const created = await pool.query(
        `INSERT INTO labor_rates (id, company_id, name, category, unit, rate_cents, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, companyId, name, category || null, unit, rateCents, body.is_active !== false, ctx.email]
      );
      sendJson(res, 201, { labor_rate: { ...created.rows[0], rate_cents: Number(created.rows[0].rate_cents) } });
      return true;
    }
    const updated = await pool.query(
      `UPDATE labor_rates SET name=$3, category=$4, unit=$5, rate_cents=$6, is_active=$7, updated_at=NOW()
        WHERE id=$1 AND company_id=$2 RETURNING *`,
      [rateId, companyId, name, category || null, unit, rateCents, body.is_active !== false]
    );
    if (!updated.rows.length) { sendJson(res, 404, { error: 'Labor rate not found.' }); return true; }
    sendJson(res, 200, { labor_rate: { ...updated.rows[0], rate_cents: Number(updated.rows[0].rate_cents) } });
    return true;
  }

  const subcontractorRatesMatch = pathname.match(/^\/api\/subcontractors\/([^/]+)\/rates$/);
  if (subcontractorRatesMatch) {
    const subcontractorId = normalizeText(subcontractorRatesMatch[1], 100);
    const subcontractor = await pool.query(
      `SELECT 1 FROM generic_entities
        WHERE id=$1 AND entity_type='Subcontractor' AND company_id=$2 LIMIT 1`,
      [subcontractorId, companyId]
    );
    if (!subcontractor.rows.length) { sendJson(res, 404, { error: 'Subcontractor not found.' }); return true; }

    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT labor_rate.id, labor_rate.name, labor_rate.category, labor_rate.unit, labor_rate.rate_cents,
                subcontractor_rate.custom_rate
           FROM labor_rates labor_rate
           LEFT JOIN subcontractor_rates subcontractor_rate
             ON subcontractor_rate.labor_rate_id=labor_rate.id
            AND subcontractor_rate.company_id=labor_rate.company_id
            AND subcontractor_rate.subcontractor_id=$2
          WHERE labor_rate.company_id=$1 AND labor_rate.is_active=true
          ORDER BY labor_rate.category NULLS LAST, labor_rate.name`,
        [companyId, subcontractorId]
      );
      sendJson(res, 200, {
        labor_rates: result.rows.map((rate) => ({
          ...rate,
          rate_cents: Number(rate.rate_cents),
          custom_rate: rate.custom_rate === null ? null : String(rate.custom_rate),
        })),
      });
      return true;
    }

    if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed.' }); return true; }
    if (!(await isCompanyAdministrator(pool, ctx, companyId))) { sendJson(res, 403, { error: 'Only company administrators can manage custom subcontractor rates.' }); return true; }
    const body = await readJson(req);
    if (!Array.isArray(body.overrides) || body.overrides.length > 200) {
      sendJson(res, 400, { error: 'Provide up to 200 custom-rate overrides.' });
      return true;
    }
    const requested = [];
    const rateIds = new Set();
    for (const override of body.overrides) {
      const laborRateId = normalizeText(override?.labor_rate_id, 100);
      const customRateCents = moneyToCents(override?.custom_rate);
      if (!laborRateId || customRateCents === null || rateIds.has(laborRateId)) {
        sendJson(res, 400, { error: 'Each custom rate must have a unique active labor rate and a valid non-negative price.' });
        return true;
      }
      rateIds.add(laborRateId);
      requested.push({ laborRateId, customRate: (customRateCents / 100).toFixed(2) });
    }
    if (rateIds.size) {
      const validRates = await pool.query(
        `SELECT id FROM labor_rates WHERE company_id=$1 AND is_active=true AND id=ANY($2::text[])`,
        [companyId, [...rateIds]]
      );
      if (validRates.rows.length !== rateIds.size) {
        sendJson(res, 400, { error: 'Custom rates can only be saved for active labor rates in this company.' });
        return true;
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM subcontractor_rates WHERE company_id=$1 AND subcontractor_id=$2',
        [companyId, subcontractorId]
      );
      for (const override of requested) {
        await client.query(
          `INSERT INTO subcontractor_rates (id, company_id, subcontractor_id, labor_rate_id, custom_rate)
           VALUES ($1,$2,$3,$4,$5)`,
          [crypto.randomUUID(), companyId, subcontractorId, override.laborRateId, override.customRate]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    sendJson(res, 200, { success: true, saved_count: requested.length });
    return true;
  }

  if (pathname === '/api/work-orders' && req.method === 'GET') {
    const status = normalizeText(url.searchParams.get('status'), 20).toLowerCase();
    if (status && !VALID_STATUSES.has(status)) { sendJson(res, 400, { error: 'Invalid status filter.' }); return true; }
    const result = await pool.query(
      `SELECT w.*, p.title AS project_title, p.address AS project_address,
              s.data->>'name' AS subcontractor_name, s.data->>'phone' AS subcontractor_phone,
              (SELECT COUNT(*)::int FROM work_order_completion_photos photo WHERE photo.work_order_id=w.id) AS photo_count
         FROM work_orders w JOIN projects p ON p.id=w.project_id AND p.company_id=w.company_id
         LEFT JOIN generic_entities s ON s.id=w.subcontractor_id AND s.company_id=w.company_id AND s.entity_type='Subcontractor'
        WHERE w.company_id=$1 ${status ? 'AND w.status=$2' : ''}
        ORDER BY w.created_at DESC LIMIT 500`,
      status ? [companyId, status] : [companyId]
    );
    sendJson(res, 200, { work_orders: result.rows.map((order) => ({ ...order, payout_cents: Number(order.payout_cents) })) });
    return true;
  }

  const workOrderMatch = pathname.match(/^\/api\/work-orders\/([^/]+)(?:\/(approve|paid|link|send))?$/);
  if (workOrderMatch && req.method === 'GET' && !workOrderMatch[2]) {
    const order = await getWorkOrder(pool, workOrderMatch[1]);
    if (!order || order.company_id !== companyId) { sendJson(res, 404, { error: 'Work order not found.' }); return true; }
    sendJson(res, 200, { work_order: await decorateWorkOrder(pool, order) });
    return true;
  }

  if (pathname === '/api/work-orders/generate' && req.method === 'POST') {
    const body = await readJson(req);
    const projectId = normalizeText(body.project_id, 100);
    const subcontractorId = normalizeText(body.subcontractor_id, 100);
    if (!projectId || !subcontractorId) { sendJson(res, 400, { error: 'Project and subcontractor are required.' }); return true; }
    const [projectResult, subcontractorResult] = await Promise.all([
      pool.query('SELECT id, title, address FROM projects WHERE id=$1 AND company_id=$2 LIMIT 1', [projectId, companyId]),
      pool.query(`SELECT id, data FROM generic_entities WHERE id=$1 AND company_id=$2 AND entity_type='Subcontractor' LIMIT 1`, [subcontractorId, companyId]),
    ]);
    if (!projectResult.rows.length || !subcontractorResult.rows.length) { sendJson(res, 404, { error: 'Project or subcontractor was not found in this company.' }); return true; }
    const calculated = await resolveRateItems(pool, companyId, subcontractorId, body.items);
    if (calculated.error) { sendJson(res, 400, { error: calculated.error }); return true; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = crypto.randomUUID();
      const workOrderNumber = `WO-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await client.query(
        `INSERT INTO work_orders
          (id, company_id, project_id, subcontractor_id, work_order_number, title, scope_of_work, payout_cents, access_token, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, companyId, projectId, subcontractorId, workOrderNumber, normalizeText(body.title, 200) || projectResult.rows[0].title || 'Work order', normalizeText(body.scope_of_work, 5000) || null, calculated.payoutCents, crypto.randomBytes(32).toString('base64url'), ctx.email]
      );
      for (const item of calculated.items) {
        await client.query(
          `INSERT INTO work_order_items
            (id, work_order_id, company_id, labor_rate_id, description, unit, quantity, unit_rate_cents, total_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [item.id, id, companyId, item.labor_rate_id, item.description, item.unit, item.quantity, item.unit_rate_cents, item.total_cents]
        );
      }
      await client.query('COMMIT');
      sendJson(res, 201, {
        work_order: { ...created.rows[0], payout_cents: Number(created.rows[0].payout_cents) },
        crew_portal_path: `/crew-portal?token=${encodeURIComponent(created.rows[0].access_token)}`,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return true;
  }

  if (workOrderMatch && req.method === 'POST' && workOrderMatch[2]) {
    const [, id, operation] = workOrderMatch;
    const order = await getWorkOrder(pool, id);
    if (!order || order.company_id !== companyId) { sendJson(res, 404, { error: 'Work order not found.' }); return true; }
    if (operation === 'send') {
      const body = await readJson(req);
      const method = normalizeText(body.method, 10).toLowerCase();
      const contact = method === 'sms' ? order.subcontractor_phone : order.subcontractor_email;
      const fail = async (message) => {
        await pool.query(
          `UPDATE work_orders
             SET invite_delivery_method=$3, invite_delivery_status='failed', invite_delivered_at=NULL,
                 invite_delivery_error=$4, updated_at=NOW()
           WHERE id=$1 AND company_id=$2`,
          [id, companyId, method || null, message]
        );
        sendJson(res, 400, { error: message, invite_delivery_status: 'failed' });
        return true;
      };
      if (!['sms', 'email'].includes(method)) return fail('Choose SMS or email.');
      if ((method === 'sms' && !isValidPhone(contact)) || (method === 'email' && !isValidEmail(contact))) {
        return fail(`This subcontractor does not have a valid ${method === 'sms' ? 'phone number' : 'email address'} on file.`);
      }
      const crewUrl = `${getAppUrl(req).replace(/\/$/, '')}/crew-portal?token=${encodeURIComponent(order.access_token)}`;
      const subcontractorName = normalizeText(order.subcontractor_name, 160) || 'Crew';
      // Record the new attempt before handing the message to an external provider.
      // This prevents a prior success from being shown as the current attempt.
      await pool.query(
        `UPDATE work_orders
           SET invite_delivery_method=$3, invite_delivery_status='sending', invite_delivered_at=NULL,
               invite_delivery_error=NULL, updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [id, companyId, method]
      );
      try {
        if (method === 'sms') {
          await sendSMS({
            to: contact,
            companyId,
            senderEmail: ctx.email,
            contactName: subcontractorName,
            message: `${subcontractorName}, your work order "${order.title}" is ready. View it here: ${crewUrl}`,
          });
        } else {
          await sendEmail({
            to: contact,
            companyId,
            subject: `Work order ready: ${order.title}`,
            html: `<p>Hi ${escapeHtml(subcontractorName)},</p><p>Your work order <strong>${escapeHtml(order.title)}</strong> is ready to review.</p><p><a href="${escapeHtml(crewUrl)}">Open work order</a></p>`,
          });
        }
      } catch (error) {
        console.warn(`[WorkOrders] ${method} invite delivery failed:`, error.message);
        await pool.query(
          `UPDATE work_orders
             SET invite_delivery_status='failed', invite_delivered_at=NULL, invite_delivery_error=$3, updated_at=NOW()
           WHERE id=$1 AND company_id=$2`,
          [id, companyId, normalizeText(error.message, 500) || 'Delivery failed.']
        );
        sendJson(res, 502, { error: `Unable to send the work-order link: ${normalizeText(error.message, 300) || 'delivery failed.'}`, invite_delivery_status: 'failed' });
        return true;
      }
      try {
        const updated = await pool.query(
          `UPDATE work_orders
             SET invite_delivery_method=$3, invite_delivery_status='sent', invite_delivered_at=NOW(),
                 invite_delivery_error=NULL, updated_at=NOW()
           WHERE id=$1 AND company_id=$2 RETURNING *`,
          [id, companyId, method]
        );
        sendJson(res, 200, { success: true, work_order: updated.rows[0], invite_delivery_status: 'sent' });
      } catch (error) {
        // The provider already accepted the message. Leave the pre-send
        // "sending" state intact rather than falsely claiming a failure and
        // encouraging an accidental duplicate resend.
        console.error(`[WorkOrders] ${method} invite sent but status update failed:`, error.message);
        sendJson(res, 202, {
          success: true,
          invite_delivery_status: 'sending',
          warning: 'The link was accepted for delivery, but its confirmation could not be saved. Check provider logs before resending.',
        });
      }
      return true;
    }
    if (!(await isCompanyAdministrator(pool, ctx, companyId))) { sendJson(res, 403, { error: 'Only company administrators can approve or mark work orders paid.' }); return true; }
    if (operation === 'link') {
      sendJson(res, 200, { crew_portal_path: `/crew-portal?token=${encodeURIComponent(order.access_token)}` });
      return true;
    }
    const expected = operation === 'approve' ? 'completed' : 'approved';
    const next = operation === 'approve' ? 'approved' : 'paid';
    const timestamp = operation === 'approve' ? 'approved_at' : 'paid_at';
    const updated = await pool.query(
      `UPDATE work_orders SET status=$3, ${timestamp}=NOW(), updated_at=NOW()
        WHERE id=$1 AND company_id=$2 AND status=$4 RETURNING *`,
      [id, companyId, next, expected]
    );
    if (!updated.rows.length) { sendJson(res, 409, { error: `This work order must be ${expected} before it can be ${next}.` }); return true; }
    sendJson(res, 200, { work_order: { ...updated.rows[0], payout_cents: Number(updated.rows[0].payout_cents) } });
    return true;
  }

  return false;
}

async function handleWorkOrderRoute(req, res, { getPool, sendSMS, sendEmail, getAppUrl }) {
  const pathname = getRequestPath(req);
  const isPublic = pathname === '/api/public/work-orders' || pathname.startsWith('/api/public/work-orders/');
  const isStaff = pathname === '/api/labor-rates' || pathname.startsWith('/api/labor-rates/')
    || pathname.startsWith('/api/subcontractors/')
    || pathname === '/api/work-orders' || pathname.startsWith('/api/work-orders/');
  if (!isPublic && !isStaff) return false;
  try {
    const pool = getPool();
    const url = new URL(req.url, 'http://localhost');
    return isPublic
      ? await handlePublicRoute(req, res, pool, pathname, url)
      : await handleStaffRoute(req, res, pool, pathname, url, { sendSMS, sendEmail, getAppUrl });
  } catch (error) {
    console.error('[WorkOrders] API error:', error.message);
    sendJson(res, error?.statusCode || 500, { error: error?.statusCode === 413 ? error.message : 'Unable to process this work-order request.' });
    return true;
  }
}

module.exports = {
  centsFor,
  moneyToCents,
  quantityToMilli,
  resolveRateItems,
  handleWorkOrderRoute,
};