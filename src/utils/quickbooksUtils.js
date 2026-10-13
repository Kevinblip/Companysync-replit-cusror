// Sentinel stored in quickbooks_payment_id / quickbooks_invoice_id when a record
// was manually entered in QuickBooks and should NOT be pushed again by the sync.
// The "QB Pending" badge is cleared, but no link is generated.
export const QB_MANUAL_SENTINEL = 'MANUAL';

export function getQBInvoiceUrl(realmId, qbId, sandbox = false) {
  if (!qbId || qbId === QB_MANUAL_SENTINEL) return null;
  const base = sandbox
    ? 'https://app.sandbox.qbo.intuit.com'
    : 'https://app.qbo.intuit.com';
  const params = new URLSearchParams({ txnId: String(qbId) });
  if (realmId) params.set('companyId', String(realmId));
  return `${base}/app/invoice?${params}`;
}

export function getQBPaymentUrl(realmId, qbId, sandbox = false) {
  if (!qbId || qbId === QB_MANUAL_SENTINEL) return null;
  const base = sandbox
    ? 'https://app.sandbox.qbo.intuit.com'
    : 'https://app.qbo.intuit.com';
  const params = new URLSearchParams({ txnId: String(qbId) });
  if (realmId) params.set('companyId', String(realmId));
  return `${base}/app/recvpayment?${params}`;
}
