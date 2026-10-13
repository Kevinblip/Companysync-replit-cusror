'use strict';

const { recalculateInvoicePaymentsInTransaction } = require('./invoicePaymentRecalculator.cjs');

function value(row, key) {
  return row?.[key] ?? row?.data?.[key] ?? null;
}

function dateOnly(valueToNormalize) {
  if (!valueToNormalize) return '';
  if (valueToNormalize instanceof Date) return valueToNormalize.toISOString().slice(0, 10);
  return String(valueToNormalize).slice(0, 10);
}

function feeNameFromNotes(notes) {
  const text = String(notes || '').trim();
  const delimiter = text.search(/\s+[—-]\s+deducted from payment,\s*no cash received/i);
  if (delimiter < 0) return '';
  return text.slice(0, delimiter).replace(/\s+\([^)]*\)\s*$/, '').trim();
}

function rateNoteFromNotes(notes) {
  const text = String(notes || '');
  const delimiter = text.search(/\s+[—-]\s+deducted from payment,\s*no cash received/i);
  if (delimiter < 0) return '';
  return text.slice(0, delimiter).match(/(\([^)]*\))\s*$/)?.[1] || '';
}

function isStandaloneFee(payment) {
  const notes = String(value(payment, 'notes') || '');
  return /deducted from payment,\s*no cash received/i.test(notes)
    && !/withheld by\s+(?:rep|sales|agent)/i.test(notes);
}

async function authorizeCompany(pool, getUserFromRequest, req, companyId) {
  const caller = req ? await getUserFromRequest(req) : null;
  if (!caller?.email) throw new Error('Authentication required');
  const membership = await pool.query(
    `SELECT 1
       FROM companies c
       LEFT JOIN users u
         ON u.company_id = c.id AND LOWER(u.email) = LOWER($1)
       LEFT JOIN staff_profiles sp
         ON sp.company_id = c.id
        AND LOWER(COALESCE(NULLIF(sp.user_email, ''), sp.email)) = LOWER($1)
        AND COALESCE(sp.is_active, true) = true
      WHERE c.id = $2
        AND (u.email IS NOT NULL OR sp.id IS NOT NULL OR LOWER(COALESCE(c.created_by, '')) = LOWER($1))
      LIMIT 1`,
    [caller.email, companyId]
  );
  if (!membership.rowCount) throw new Error('Not authorized for this company');
  return caller;
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function createFinancialOperations({ getPool, getUserFromRequest }) {
  async function undoStandaloneFeeDeduction(params, apiKey, req) {
    const paymentId = params?.paymentId;
    const companyId = params?.companyId;
    if (!paymentId || !companyId) return { success: false, error: 'paymentId and companyId required' };
    const pool = getPool();
    try {
      await authorizeCompany(pool, getUserFromRequest, req, companyId);
      return await withTransaction(pool, async client => {
        // A company lock prevents two fee reversals from assigning the same
        // unlinked legacy expense. The narrower invoice lock documents and
        // serializes invoice-balance ownership after the payment is known.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-financial:${companyId}`]);
        const paymentResult = await client.query(
          `SELECT * FROM payments WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [paymentId, companyId]
        );
        if (!paymentResult.rowCount) {
          return { success: true, already_deleted: true };
        }
        const payment = paymentResult.rows[0];
        if (!isStandaloneFee(payment)) throw new Error('Payment is not a standalone fee deduction');

        const invoiceId = value(payment, 'invoice_id');
        const invoiceNumber = value(payment, 'invoice_number');
        const invoiceKey = invoiceId || invoiceNumber;
        if (!invoiceKey) throw new Error('Fee payment has no invoice ownership');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          [String(companyId), String(invoiceKey)]
        );

        const paymentExpenseId = value(payment, 'withheld_expense_id');
        const backlinkResult = await client.query(
          `SELECT id, company_id, data FROM generic_entities
           WHERE entity_type = 'Expense' AND company_id = $1
             AND data->>'withheld_offset_payment_id' = $2
           ORDER BY id FOR UPDATE`,
          [companyId, paymentId]
        );
        if (backlinkResult.rowCount > 1) throw new Error('Conflicting expenses claim this payment');
        if (paymentExpenseId && backlinkResult.rowCount === 1
            && String(backlinkResult.rows[0].id) !== String(paymentExpenseId)
            && String(backlinkResult.rows[0].data?.id || '') !== String(paymentExpenseId)) {
          throw new Error('Conflicting explicit withheld expense ids');
        }

        let expense = backlinkResult.rows[0] || null;
        let linkedExpenseAlreadyAbsent = false;
        if (paymentExpenseId) {
          const linkedResult = await client.query(
            `SELECT id, company_id, data FROM generic_entities
             WHERE entity_type = 'Expense' AND company_id = $1
               AND (id = $2 OR data->>'id' = $2)
             FOR UPDATE`,
            [companyId, String(paymentExpenseId)]
          );
          if (!linkedResult.rowCount) {
            // This is the only safe partial-state retry: the payment itself
            // names the absent expense. Do not search for or claim a different
            // expense using the legacy fingerprint.
            linkedExpenseAlreadyAbsent = true;
          }
          if (linkedResult.rowCount > 1) throw new Error('Linked expense id is ambiguous');
          if (linkedResult.rowCount === 1) {
            expense = linkedResult.rows[0];
            const expensePaymentId = value(expense, 'withheld_offset_payment_id');
            if (expensePaymentId && String(expensePaymentId) !== String(paymentId)) {
              throw new Error('Conflicting explicit withheld payment id');
            }
          }
        }

        if (!expense && !linkedExpenseAlreadyAbsent) {
          const feeName = feeNameFromNotes(value(payment, 'notes'));
          const rateNote = rateNoteFromNotes(value(payment, 'notes'));
          if (!feeName) throw new Error('Legacy fee fingerprint is incomplete');
          const legacyResult = await client.query(
            `SELECT id, company_id, data FROM generic_entities
             WHERE entity_type = 'Expense' AND company_id = $1
               AND COALESCE(data->>'withheld_offset_payment_id', '') = ''
               AND LOWER(BTRIM(COALESCE(data->>'vendor_name', ''))) = LOWER($2)
               AND ROUND(COALESCE(NULLIF(data->>'amount','')::numeric, 0), 2) = ROUND($3::numeric, 2)
               AND LEFT(COALESCE(data->>'expense_date', ''), 10) = $4
               AND COALESCE(data->>'reference_number', '') = COALESCE($5, '')
               AND ($6::text IS NULL OR COALESCE(data->>'invoice_id', $6) = $6)
               AND ($7::text IS NULL OR COALESCE(data->>'customer_id', $7) = $7)
               AND ($8::text = '' OR POSITION(LOWER($8) IN LOWER(COALESCE(data->>'description', ''))) > 0)
             ORDER BY id FOR UPDATE`,
            [
              companyId,
              feeName,
              Number(value(payment, 'amount') || 0),
              dateOnly(value(payment, 'payment_date')),
              invoiceNumber || null,
              invoiceId || null,
              value(payment, 'customer_id') || null,
              rateNote,
            ]
          );
          if (!legacyResult.rowCount) throw new Error('Matching legacy expense was not found');
          if (legacyResult.rowCount !== 1) throw new Error('Legacy expense fingerprint is ambiguous');
          expense = legacyResult.rows[0];
        }

        if (expense) {
          if (String(expense.company_id) !== String(companyId)) throw new Error('Expense ownership could not be verified');
          const expenseInvoiceId = value(expense, 'invoice_id');
          const expenseCustomerId = value(expense, 'customer_id');
          const expenseInvoiceNumber = value(expense, 'reference_number');
          if (invoiceId && expenseInvoiceId && String(invoiceId) !== String(expenseInvoiceId)) {
            throw new Error('Conflicting explicit invoice ids');
          }
          if (value(payment, 'customer_id') && expenseCustomerId
              && String(value(payment, 'customer_id')) !== String(expenseCustomerId)) {
            throw new Error('Conflicting explicit customer ids');
          }
          if (invoiceNumber && expenseInvoiceNumber
              && String(invoiceNumber) !== String(expenseInvoiceNumber)) {
            throw new Error('Conflicting explicit invoice numbers');
          }
          await client.query(
            `DELETE FROM generic_entities
             WHERE id = $1 AND entity_type = 'Expense' AND company_id = $2`,
            [expense.id, companyId]
          );
        }
        await client.query('DELETE FROM payments WHERE id = $1 AND company_id = $2', [paymentId, companyId]);
        const recalculated = await recalculateInvoicePaymentsInTransaction(client, {
          companyId,
          invoiceId: invoiceId || null,
          invoiceNumber: invoiceId ? null : invoiceNumber,
        });
        return {
          success: true,
          expense_id: expense?.id || String(paymentExpenseId),
          ...(linkedExpenseAlreadyAbsent ? { expense_already_deleted: true } : {}),
          ...recalculated,
        };
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function recalculateInvoicePayments(params, apiKey, req) {
    const pool = getPool();
    try {
      const requestedCompanyId = params?.company_id || params?.companyId;
      let companyId = requestedCompanyId;
      if (!companyId && params?.invoice_id) {
        const result = await pool.query('SELECT company_id FROM invoices WHERE id = $1', [params.invoice_id]);
        companyId = result.rows[0]?.company_id;
      }
      if (!companyId) {
        const caller = req ? await getUserFromRequest(req) : null;
        companyId = caller?.company_id || null;
      }
      if (!companyId) throw new Error('No company context');
      await authorizeCompany(pool, getUserFromRequest, req, companyId);
      return await withTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-financial:${companyId}`]);
        return recalculateInvoicePaymentsInTransaction(client, {
          companyId,
          invoiceId: params?.invoice_id || null,
          invoiceNumber: params?.invoice_number || null,
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { undoStandaloneFeeDeduction, recalculateInvoicePayments };
}

module.exports = {
  createFinancialOperations,
  dateOnly,
  feeNameFromNotes,
  isStandaloneFee,
  rateNoteFromNotes,
};