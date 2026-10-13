/**
 * Sending estimates and invoices by text message.
 *
 * The subject of an estimate is very often still a LEAD, not a customer, and
 * leads frequently have a phone number long before they ever give an email
 * address. Email-only sending left those people unreachable from the document
 * itself, so every send surface (estimate editor, estimates list, invoice
 * detail, invoice list) can now text instead.
 *
 * These are pure helpers so the message wording and the money on it can be
 * tested without a browser, a Twilio account, or a live record.
 *
 * MONEY RULES (do not "simplify" these):
 *   - An invoice's balance is total_amount - amount_paid. `invoice.amount` is a
 *     frozen legacy field from the old `data` JSONB and is routinely stale, so
 *     it must never be texted to a customer as an amount owed.
 *   - An estimate's total prefers total_rcv (what the carrier-facing document
 *     actually adds up to) and falls back to `amount` for older records.
 */

import { formatToE164 } from '@/utils';

/** Coerce anything numeric-ish to a finite number, else 0. */
function toFiniteNumber(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format money for a text message — no currency code noise, just $1,234.56. */
export function formatSmsMoney(value) {
  return `$${toFiniteNumber(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Pick the first usable phone number out of an ordered list of candidates.
 *
 * Accepts already-international numbers (+44...) as-is; US-style numbers are
 * normalized to E.164 so Twilio accepts them. Returns null when nothing in the
 * list is dialable — callers must treat null as "cannot text", never as "send
 * anyway and hope".
 */
export function resolveSmsPhone(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const raw = String(candidate).trim();
    if (!raw) continue;

    const usFormatted = formatToE164(raw);
    if (usFormatted) return usFormatted;

    // Already-international numbers: keep the caller's own formatting.
    if (raw.startsWith('+')) {
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
    }
  }
  return null;
}

/**
 * Whether any of these candidates yields a dialable number.
 *
 * Render gates MUST use this with the SAME candidate list the send handler
 * uses. Gating a "Text" button on the document's own phone snapshot while the
 * handler falls back to the linked customer or lead means the button is hidden
 * for exactly the records the fallback was written to rescue.
 */
export function hasTextablePhone(...candidates) {
  return resolveSmsPhone(...candidates) !== null;
}

/** First name only — a text greeting reading "Hi Jonathan Michael Eaddy," is odd. */
export function firstNameOf(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first || 'there';
}

/** The figure an estimate should quote in a text message. */
export function estimateSmsTotal(estimate) {
  if (!estimate) return 0;
  if (estimate.total_rcv !== undefined && estimate.total_rcv !== null && estimate.total_rcv !== '') {
    return toFiniteNumber(estimate.total_rcv);
  }
  return toFiniteNumber(estimate.amount);
}

/**
 * The outstanding balance on an invoice.
 * Never uses `invoice.amount` — see MONEY RULES above.
 */
export function invoiceSmsBalance(invoice) {
  if (!invoice) return 0;
  const total = toFiniteNumber(invoice.total_amount);
  const paid = toFiniteNumber(invoice.amount_paid);
  return Math.max(0, total - paid);
}

/**
 * Text body for an estimate.
 * `shareUrl` is optional: when the signed public link can't be produced we
 * still send a useful message rather than a broken or unsigned URL.
 */
export function buildEstimateSmsMessage({ estimate, companyName, shareUrl } = {}) {
  const est = estimate || {};
  const who = firstNameOf(est.customer_name);
  const number = est.estimate_number ? ` ${est.estimate_number}` : '';
  const total = formatSmsMoney(estimateSmsTotal(est));
  const from = companyName || 'Your Team';

  const lines = [
    `Hi ${who}! Your estimate${number} from ${from} is ready.`,
    '',
    `Total: ${total}`,
  ];
  if (shareUrl) {
    lines.push('', `View the full estimate: ${shareUrl}`);
  }
  lines.push('', `- ${from}`);
  return lines.join('\n');
}

/**
 * Text body for an invoice.
 * `payUrl` is optional (Stripe link); without it the customer is told how to
 * reach the company instead of being sent to a dead end.
 */
export function buildInvoiceSmsMessage({ invoice, companyName, payUrl, companyPhone } = {}) {
  const inv = invoice || {};
  const who = firstNameOf(inv.customer_name);
  const number = inv.invoice_number ? ` ${inv.invoice_number}` : '';
  const balance = formatSmsMoney(invoiceSmsBalance(inv));
  const from = companyName || 'Your Team';

  const lines = [
    `Hi ${who}! Invoice${number} from ${from}.`,
    '',
    `Amount due: ${balance}`,
  ];
  if (payUrl) {
    lines.push('', `Pay securely here: ${payUrl}`);
  } else if (companyPhone) {
    lines.push('', `Questions or to pay by phone, call ${companyPhone}.`);
  }
  lines.push('', `Thank you!\n- ${from}`);
  return lines.join('\n');
}
