'use strict';

/**
 * Per-company invoice numbers and payment links.
 *
 * invoice_number is a display label. invoice id is the only link that moves
 * money. Two customers in the live YICN tenant both held INV-2026-0385
 * (Chad Sohl and Beverly Owens-Jackson) because every generator did max+1
 * without a lock, and there is no unique index. Payments recorded by that
 * number used LIMIT 1 and landed on whichever row came back first.
 *
 * Allocation must run inside the same transaction as the INSERT. The
 * advisory lock is held until commit, so the next allocator sees the row
 * this transaction wrote.
 */

const INVOICE_NUMBER_LOCK_NAMESPACE = 'companysync-invoice-number';

function validateCompanyId(companyId) {
  const normalized = String(companyId || '').trim();
  if (!normalized) {
    const error = new Error('A company id is required to allocate an invoice number.');
    error.code = 'COMPANY_REQUIRED';
    throw error;
  }
  return normalized;
}

function validateYear(year) {
  const normalized = Number(year);
  if (!Number.isInteger(normalized) || normalized < 1000 || normalized > 9999) {
    const error = new Error('A four-digit invoice-number year is required.');
    error.code = 'INVALID_YEAR';
    throw error;
  }
  return normalized;
}

function sameLabel(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Same high-water rules as src/utils/invoiceNumbering.js.
 * Suffixes longer than 9 digits are timestamp leftovers and are ignored,
 * but every existing value stays in the taken set so it is never reissued.
 */
function nextInvoiceNumberFromNumbers(sourceNumbers, year = new Date().getFullYear()) {
  const normalizedYear = validateYear(year);
  const prefix = `INV-${normalizedYear}-`;
  const taken = [];
  for (const value of sourceNumbers || []) {
    if (typeof value !== 'string') continue;
    const number = value.trim();
    if (number) taken.push(number);
  }

  let maxSeq = 0;
  for (const number of taken) {
    const withYear = /^INV-(\d{4})-(\d+)$/.exec(number);
    if (withYear) {
      if (Number(withYear[1]) === normalizedYear && withYear[2].length <= 9) {
        maxSeq = Math.max(maxSeq, Number(withYear[2]));
      }
      continue;
    }
    const legacy = /^INV-(\d+)$/.exec(number);
    if (legacy && legacy[1].length <= 9) {
      maxSeq = Math.max(maxSeq, Number(legacy[1]));
    }
  }

  let sequence = maxSeq + 1;
  let candidate = `${prefix}${String(sequence).padStart(4, '0')}`;
  const ceiling = maxSeq + 10000;
  while (taken.some(number => sameLabel(number, candidate)) && sequence < ceiling) {
    sequence += 1;
    candidate = `${prefix}${String(sequence).padStart(4, '0')}`;
  }
  return candidate;
}

function chooseInvoiceNumber({ numbers, requested, year, keepWhenTaken } = {}) {
  const wanted = String(requested || '').trim();
  const list = (numbers || []).map(number => String(number || '').trim()).filter(Boolean);
  if (wanted && !list.some(number => sameLabel(number, wanted))) {
    return { invoiceNumber: wanted, replaced: false, requested: wanted };
  }
  if (wanted && keepWhenTaken) {
    return {
      invoiceNumber: String(keepWhenTaken).trim(),
      replaced: !sameLabel(keepWhenTaken, wanted),
      requested: wanted,
      keptExisting: true,
    };
  }
  const invoiceNumber = nextInvoiceNumberFromNumbers(list, year || new Date().getFullYear());
  return {
    invoiceNumber,
    replaced: !!wanted && !sameLabel(wanted, invoiceNumber),
    requested: wanted || null,
  };
}

async function lockCompanyInvoiceNumbers(client, companyId) {
  const normalizedCompanyId = validateCompanyId(companyId);
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [normalizedCompanyId, INVOICE_NUMBER_LOCK_NAMESPACE],
  );
}

/**
 * @param {object} options
 * @param {string} [options.requested] keep this label when it is free
 * @param {string} [options.exceptId] ignore this invoice when checking collisions (sync updates)
 * @param {string} [options.keepWhenTaken] if requested is taken by someone else, keep this existing label instead of minting a new one on every sync
 * @param {number} [options.year]
 */
async function allocateInvoiceNumber(client, companyId, options = {}) {
  const normalizedCompanyId = validateCompanyId(companyId);
  const year = validateYear(options.year || new Date().getFullYear());
  await lockCompanyInvoiceNumbers(client, normalizedCompanyId);
  const exceptId = options.exceptId || null;
  const listed = await client.query(
    `SELECT COALESCE(NULLIF(BTRIM(invoice_number), ''), NULLIF(BTRIM(data->>'invoice_number'), '')) AS invoice_number
       FROM invoices
      WHERE company_id = $1
        AND ($2::text IS NULL OR id <> $2)`,
    [normalizedCompanyId, exceptId],
  );
  return chooseInvoiceNumber({
    numbers: (listed.rows || []).map(row => row.invoice_number),
    requested: options.requested,
    year,
    keepWhenTaken: options.keepWhenTaken || null,
  });
}

function pickInvoiceRow(rows, { customerId, customerName } = {}) {
  const list = (rows || []).filter(row => row && row.id);
  if (list.length === 0) return { invoice: null, ambiguous: false, count: 0 };
  if (list.length === 1) return { invoice: list[0], ambiguous: false, count: 1 };

  let pool = list;
  if (customerId) {
    const byId = pool.filter(row => row.customer_id && String(row.customer_id) === String(customerId));
    if (byId.length === 1) return { invoice: byId[0], ambiguous: false, count: 1 };
    if (byId.length > 1) pool = byId;
  }
  if (customerName) {
    const byName = pool.filter(row => sameLabel(row.customer_name, customerName));
    if (byName.length === 1) return { invoice: byName[0], ambiguous: false, count: 1 };
  }
  return { invoice: null, ambiguous: true, count: list.length };
}

/**
 * Decide which invoice a payment belongs to.
 * An invoice id is authoritative. A number is used only when it matches
 * exactly one invoice, or exactly one invoice for the named customer.
 * Anything else is refused — guessing is how Chad's payments paid Beverly's invoice.
 */
async function resolvePaymentInvoiceLink(client, {
  companyId,
  invoiceId,
  invoiceNumber,
  customerId,
  customerName,
} = {}) {
  const normalizedCompanyId = validateCompanyId(companyId);
  const explicitId = String(invoiceId || '').trim();
  if (explicitId) {
    const found = await client.query(
      `SELECT id, invoice_number, customer_id, customer_name
         FROM invoices
        WHERE company_id = $1 AND id = $2`,
      [normalizedCompanyId, explicitId],
    );
    if ((found.rowCount || found.rows?.length || 0) !== 1) {
      const error = new Error('Invoice id was not found in this company.');
      error.code = 'INVOICE_NOT_FOUND';
      throw error;
    }
    const invoice = found.rows[0];
    return {
      linked: true,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number || null,
      customer_id: invoice.customer_id || customerId || null,
      customer_name: invoice.customer_name || customerName || null,
    };
  }

  const number = String(invoiceNumber || '').trim();
  if (!number || number.toLowerCase() === 'none') {
    return { linked: false, invoice_id: null, invoice_number: null, unmatched_number: null };
  }

  const found = await client.query(
    `SELECT id,
            COALESCE(NULLIF(BTRIM(invoice_number), ''), NULLIF(BTRIM(data->>'invoice_number'), '')) AS invoice_number,
            customer_id,
            customer_name
       FROM invoices
      WHERE company_id = $1
        AND lower(btrim(COALESCE(invoice_number, data->>'invoice_number', ''))) = lower(btrim($2))
      ORDER BY id`,
    [normalizedCompanyId, number],
  );
  const picked = pickInvoiceRow(found.rows, { customerId, customerName });
  if (picked.ambiguous) {
    const error = new Error(
      `Invoice number ${number} belongs to ${picked.count} invoices. Record the payment on the invoice itself so it links by invoice id.`,
    );
    error.code = 'AMBIGUOUS_INVOICE_NUMBER';
    throw error;
  }
  if (!picked.invoice) {
    return { linked: false, invoice_id: null, invoice_number: null, unmatched_number: number };
  }
  const invoice = picked.invoice;
  return {
    linked: true,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number || null,
    customer_id: invoice.customer_id || customerId || null,
    customer_name: invoice.customer_name || customerName || null,
  };
}

function stashSupersededNumber(data, requested) {
  if (!requested) return;
  const prior = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  data.data = { ...prior, superseded_invoice_number: requested };
}

/**
 * Mutates a create payload before it is inserted.
 * Invoice creates receive a company-unique number.
 * Payment creates receive an invoice id; the stored invoice number is copied
 * from that invoice for display.
 */
async function prepareEntityWrite(client, entityType, data) {
  if (!data || !data.company_id) return data;
  if (entityType === 'invoices') {
    const assigned = await allocateInvoiceNumber(client, data.company_id, {
      requested: data.invoice_number,
    });
    data.invoice_number = assigned.invoiceNumber;
    if (assigned.replaced && assigned.requested) stashSupersededNumber(data, assigned.requested);
    return data;
  }
  if (entityType === 'payments') {
    const link = await resolvePaymentInvoiceLink(client, {
      companyId: data.company_id,
      invoiceId: data.invoice_id,
      invoiceNumber: data.invoice_number,
      customerId: data.customer_id,
      customerName: data.customer_name,
    });
    data.invoice_id = link.invoice_id;
    data.invoice_number = link.invoice_number;
    if (!link.linked && link.unmatched_number) {
      if (!data.reference_number) data.reference_number = link.unmatched_number;
    }
    if (link.linked) {
      if (!data.customer_id && link.customer_id) data.customer_id = link.customer_id;
      if (!data.customer_name && link.customer_name) data.customer_name = link.customer_name;
    }
    return data;
  }
  return data;
}

async function withInvoiceWriteTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  INVOICE_NUMBER_LOCK_NAMESPACE,
  allocateInvoiceNumber,
  chooseInvoiceNumber,
  lockCompanyInvoiceNumbers,
  nextInvoiceNumberFromNumbers,
  pickInvoiceRow,
  prepareEntityWrite,
  resolvePaymentInvoiceLink,
  withInvoiceWriteTransaction,
};
