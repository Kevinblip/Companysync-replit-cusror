/**
 * Pure guard helpers that determine when payment-related submit buttons
 * should be disabled to prevent duplicate or overpayment entries.
 *
 * Exported so they can be used by page components AND imported directly
 * in unit tests — ensuring tests always exercise the same logic path.
 */

import { normalizeName } from './duplicateCheck';

/**
 * Finds existing payments that look like a duplicate of a candidate payment.
 * A match is the SAME amount AND (same linked invoice OR same customer) AND
 * within `windowDays` of the candidate's payment date. This is the common
 * corruption pattern when several staff record the same claim payment.
 *
 * Returns the array of matching existing payments (empty when none) so callers
 * can warn / require confirmation before creating.
 *
 * @param {Array<object>} existingPayments
 * @param {{invoice_number?:string, customer_name?:string, customer_id?:string, amount:number|string, payment_date?:string, id?:string}} candidate
 * @param {{windowDays?:number}} [opts]
 */
export function findDuplicatePayment(existingPayments, candidate, opts = {}) {
  const windowDays = opts.windowDays ?? 3;
  const amt = Number(candidate?.amount || 0);
  if (!(amt > 0)) return [];
  const candDate = candidate?.payment_date ? new Date(candidate.payment_date) : null;
  const candName = candidate?.customer_name ? normalizeName(candidate.customer_name) : '';
  const hasInvoice = candidate?.invoice_number && candidate.invoice_number !== 'none';
  const DEAD_STATUSES = ['failed', 'refunded', 'void', 'cancelled'];
  return (existingPayments || []).filter((p) => {
    if (!p || (candidate?.id && p.id === candidate.id)) return false;
    if (p.status && DEAD_STATUSES.includes(String(p.status).toLowerCase())) return false;
    if (Number(p.amount || 0).toFixed(2) !== amt.toFixed(2)) return false;
    const sameInvoice = hasInvoice && p.invoice_number === candidate.invoice_number;
    const sameCustomer =
      (candidate?.customer_id && p.customer_id === candidate.customer_id) ||
      (candName && normalizeName(p.customer_name) === candName);
    if (!sameInvoice && !sameCustomer) return false;
    if (candDate && p.payment_date) {
      const diffDays = Math.abs((new Date(p.payment_date) - candDate) / 86400000);
      if (diffDays > windowDays) return false;
    }
    return true;
  });
}

/**
 * Returns true (submit should be DISABLED) when the selected invoice is
 * already paid in full or the entered amount would overpay the balance.
 * Used by the "Create Payment" dialog in Payments.jsx.
 *
 * @param {object|null} invoice  - The invoice object (or null if none selected)
 * @param {string}      enteredAmtStr - The raw string value from the amount input
 */
export function isPaymentCreateBlocked(invoice, enteredAmtStr) {
  if (!invoice) return false;
  const totalAmt = Number(invoice.total_amount || invoice.amount || 0);
  const amtPaid = Number(invoice.amount_paid || 0);
  const balance = Math.max(0, totalAmt - amtPaid);
  const isAlreadyPaid = invoice.status === 'paid' || (totalAmt > 0 && amtPaid >= totalAmt);
  if (isAlreadyPaid) return true;
  const enteredAmt = parseFloat(enteredAmtStr);
  return !isNaN(enteredAmt) && enteredAmt > balance + 0.005;
}

/**
 * Returns true (submit should be DISABLED) when saving an edited payment
 * would either leave the invoice in an over-paid state or would be paying
 * an already-fully-paid invoice.
 *
 * When editing a payment on the SAME invoice, the original payment amount is
 * subtracted from invoice.amount_paid first, so the payment's own contribution
 * is not counted twice.
 *
 * @param {object|null} invoice                - The invoice currently linked
 * @param {string}      enteredAmtStr          - Raw string from the amount input
 * @param {string|null} originalInvoiceNumber  - Invoice number before the edit began
 * @param {string|number} originalAmount       - Payment amount before the edit began
 */
export function isPaymentEditBlocked(invoice, enteredAmtStr, originalInvoiceNumber, originalAmount) {
  if (!invoice) return false;
  const totalAmt = Number(invoice.total_amount || invoice.amount || 0);
  const rawAmtPaid = Number(invoice.amount_paid || 0);
  const sameInvoice = originalInvoiceNumber === invoice.invoice_number;
  const origAmt = parseFloat(originalAmount) || 0;
  const projectedAmtPaid = sameInvoice ? Math.max(0, rawAmtPaid - origAmt) : rawAmtPaid;
  const balance = Math.max(0, totalAmt - projectedAmtPaid);
  const isAlreadyPaid = totalAmt > 0 && projectedAmtPaid >= totalAmt;
  const enteredAmt = parseFloat(enteredAmtStr);
  const wouldOverpay = !isNaN(enteredAmt) && enteredAmt > balance + 0.005;
  return isAlreadyPaid || wouldOverpay;
}

/**
 * Returns true (button should be DISABLED) when there is no remaining
 * balance on an invoice — i.e. it is already paid in full (or over-paid).
 * Used by the "Record Payment" trigger button in invoice-details.jsx.
 *
 * @param {number} total       - Invoice total amount
 * @param {number} amountPaid  - Amount already paid against the invoice
 */
export function isRecordPaymentBlocked(total, amountPaid) {
  return (total - amountPaid) <= 0;
}

/**
 * Computes the authoritative invoice state from its remaining received payments.
 * This mirrors the recalculation performed by the `recalculateInvoicePayments`
 * serverless function after a payment is deleted.
 *
 * Only payments with status "received" contribute to the total — pending,
 * processing, and other statuses are excluded.
 *
 * @param {Array<{amount: number|string, status: string}>} remainingPayments - All payments still linked to the invoice
 * @param {number|string} invoiceTotal   - The invoice's total amount
 * @param {string}        currentStatus  - The invoice's current status (preserved for draft/cancelled/void)
 * @returns {{amount_paid: number, status: string}}
 */
export function computeInvoiceRecalcState(remainingPayments, invoiceTotal, currentStatus) {
  const total = Number(invoiceTotal || 0);
  const received = (remainingPayments || []).filter(p => (p.status || '') === 'received');
  const totalPaid = received.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  let status;
  if (totalPaid <= 0) {
    status = ['draft', 'cancelled', 'void'].includes(currentStatus) ? currentStatus : 'sent';
  } else if (total > 0 && totalPaid >= total) {
    status = 'paid';
  } else {
    status = 'partially_paid';
  }

  return { amount_paid: totalPaid, status };
}

/**
 * Computes the projected outstanding balance and new status for a "Paid"
 * invoice when one or more payments totalling `deletedAmount` are removed.
 *
 * Returns null when the invoice is missing or NOT currently marked "paid"
 * (no warning is needed in that case).
 *
 * Used by the single-payment / table-row delete flow (initiateDeletePayment)
 * in Payments.jsx, and exercised directly in unit tests.
 *
 * @param {object|null} invoice        - The linked invoice (or null)
 * @param {number|string} deletedAmount - Total payment amount being removed
 * @returns {{invoice_number: any, outstandingBalance: number, newStatus: string}|null}
 */
export function getPaidInvoiceDeleteWarning(invoice, deletedAmount) {
  if (!invoice || invoice.status !== 'paid') return null;
  const invoiceTotal = Number(invoice.amount || 0);
  const currentAmountPaid = Number(invoice.amount_paid || 0);
  const newAmountPaid = Math.max(0, currentAmountPaid - Number(deletedAmount || 0));
  const outstandingBalance = Math.max(0, invoiceTotal - newAmountPaid);
  return {
    invoice_number: invoice.invoice_number,
    outstandingBalance,
    newStatus: newAmountPaid <= 0 ? 'Sent' : 'Partially Paid',
  };
}

/**
 * Aggregates a set of selected payments by their linked "Paid" invoice and
 * computes, per affected invoice, how much would be removed and what the
 * resulting balance / status would be after a bulk delete.
 *
 * Only invoices currently marked "paid" are included — payments linked to
 * non-paid (or missing) invoices contribute no warning. Multiple selected
 * payments against the same invoice are summed.
 *
 * Used by the bulk-delete flow (handleBulkDelete) in Payments.jsx, and
 * exercised directly in unit tests.
 *
 * @param {Array<string>} selectedPaymentIds - IDs of the selected payments
 * @param {Array<object>} payments           - All payment records
 * @param {Array<object>} invoices           - All invoice records
 * @returns {Array<{invoice_number: any, invoiceTotal: number, currentAmountPaid: number, deletedAmount: number, paymentCount: number, outstandingBalance: number, newStatus: string}>}
 */
export function getBulkPaidInvoiceDeleteWarnings(selectedPaymentIds, payments, invoices) {
  const affectedByInvoice = {};
  for (const id of selectedPaymentIds) {
    const payment = payments.find(p => p.id === id);
    if (!payment) continue;
    const linkedInvoice = invoices.find(i => i.invoice_number === payment.invoice_number);
    if (linkedInvoice && linkedInvoice.status === 'paid') {
      const key = linkedInvoice.invoice_number;
      if (!affectedByInvoice[key]) {
        affectedByInvoice[key] = {
          invoice_number: linkedInvoice.invoice_number,
          invoiceTotal: Number(linkedInvoice.amount || 0),
          currentAmountPaid: Number(linkedInvoice.amount_paid || 0),
          deletedAmount: 0,
          paymentCount: 0,
        };
      }
      affectedByInvoice[key].deletedAmount += Number(payment.amount || 0);
      affectedByInvoice[key].paymentCount += 1;
    }
  }

  return Object.values(affectedByInvoice).map((info) => {
    const newAmountPaid = Math.max(0, info.currentAmountPaid - info.deletedAmount);
    const outstandingBalance = Math.max(0, info.invoiceTotal - newAmountPaid);
    return {
      ...info,
      outstandingBalance,
      newStatus: newAmountPaid <= 0 ? 'Sent' : 'Partially Paid',
    };
  });
}
