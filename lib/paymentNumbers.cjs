'use strict';

const PAYMENT_NUMBER_LOCK_NAMESPACE = 'companysync-payment-number';

function validateCompanyId(companyId) {
  const normalized = String(companyId || '').trim();
  if (!normalized) throw new Error('A company id is required to allocate a payment number.');
  return normalized;
}

function validateYear(year) {
  const normalized = Number(year);
  if (!Number.isInteger(normalized) || normalized < 1000 || normalized > 9999) {
    throw new Error('A four-digit payment-number year is required.');
  }
  return normalized;
}

async function lockCompanyPaymentNumbers(client, companyId) {
  const normalizedCompanyId = validateCompanyId(companyId);
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [normalizedCompanyId, PAYMENT_NUMBER_LOCK_NAMESPACE],
  );
}

async function allocatePaymentNumber(client, companyId, year = new Date().getFullYear()) {
  const normalizedCompanyId = validateCompanyId(companyId);
  const normalizedYear = validateYear(year);

  // Callers must use this inside the transaction that inserts/updates the
  // payment. The same company lock is used by backfill so neither path can
  // observe the same maximum and allocate the same next number.
  await lockCompanyPaymentNumbers(client, normalizedCompanyId);

  const pattern = `^PAY-${normalizedYear}-([0-9]+)$`;
  const maxResult = await client.query(
    `SELECT COALESCE(MAX(
              CASE WHEN payment_value ~ $2
                   THEN substring(payment_value FROM $3)::bigint
              END
            ), 0) AS max_number
     FROM (
       SELECT COALESCE(NULLIF(BTRIM(payment_number), ''), NULLIF(BTRIM(data->>'payment_number'), '')) AS payment_value
       FROM payments
       WHERE company_id = $1
     ) numbered_payments`,
    [normalizedCompanyId, pattern, pattern],
  );
  const next = Number(maxResult.rows?.[0]?.max_number || 0) + 1;
  if (!Number.isSafeInteger(next) || next < 1) {
    throw new Error('Could not determine the next payment number.');
  }

  return `PAY-${normalizedYear}-${String(next).padStart(4, '0')}`;
}

async function backfillMissingPaymentNumbers(pool, companyId) {
  const normalizedCompanyId = validateCompanyId(companyId);
  const client = await pool.connect();
  let assigned = 0;
  let total = 0;

  try {
    await client.query('BEGIN');
    await lockCompanyPaymentNumbers(client, normalizedCompanyId);

    const totals = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (
                WHERE COALESCE(NULLIF(BTRIM(payment_number), ''), NULLIF(BTRIM(data->>'payment_number'), '')) IS NOT NULL
              )::int AS already_numbered
       FROM payments
       WHERE company_id = $1`,
      [normalizedCompanyId],
    );
    total = Number(totals.rows?.[0]?.total || 0);

    const missing = await client.query(
      `SELECT id,
              EXTRACT(YEAR FROM COALESCE(created_at, payment_date, NOW()))::int AS payment_year
       FROM payments
       WHERE company_id = $1
         AND COALESCE(NULLIF(BTRIM(payment_number), ''), NULLIF(BTRIM(data->>'payment_number'), '')) IS NULL
       ORDER BY COALESCE(created_at, payment_date) NULLS FIRST, id
       FOR UPDATE`,
      [normalizedCompanyId],
    );

    for (const payment of missing.rows || []) {
      const paymentNumber = await allocatePaymentNumber(
        client,
        normalizedCompanyId,
        payment.payment_year,
      );
      const result = await client.query(
        `UPDATE payments
         SET payment_number = $1
         WHERE id = $2
           AND company_id = $3
           AND COALESCE(NULLIF(BTRIM(payment_number), ''), NULLIF(BTRIM(data->>'payment_number'), '')) IS NULL
         RETURNING id`,
        [paymentNumber, payment.id, normalizedCompanyId],
      );
      assigned += result.rowCount || 0;
    }

    await client.query('COMMIT');
    return {
      total_payments: total,
      already_had_number: total - assigned,
      successfully_assigned: assigned,
      errors: 0,
      error_details: [],
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PAYMENT_NUMBER_LOCK_NAMESPACE,
  lockCompanyPaymentNumbers,
  allocatePaymentNumber,
  backfillMissingPaymentNumbers,
};