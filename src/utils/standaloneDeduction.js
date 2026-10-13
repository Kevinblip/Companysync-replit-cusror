// Shared by the preview and submit guard: an empty field is never an amount.
export function previewStandaloneDeduction(value, balance) {
  const raw = String(value ?? '').trim();
  const balanceCents = Math.round(Number(balance) * 100);
  let error = '';
  if (!raw) error = 'Enter the amount actually withheld. A blank amount will not be recorded.';
  else if (!/^(?:\d+|\d*\.\d{1,2})$/.test(raw) || !Number.isFinite(Number(raw))) {
    error = 'Enter a valid dollar amount with no more than two decimal places.';
  }
  const cents = Math.round(Number(raw) * 100);
  if (!error && cents <= 0) error = 'Enter an amount greater than $0.00.';
  if (!error && (!Number.isSafeInteger(balanceCents) || balanceCents <= 0)) {
    error = 'There is no remaining balance to deduct from.';
  }
  if (!error && (!Number.isSafeInteger(cents) || cents > balanceCents)) {
    error = 'The deduction cannot exceed the remaining invoice balance.';
  }
  return error
    ? { error, amount: null, remainingBalance: null }
    : { error: '', amount: cents / 100, remainingBalance: (balanceCents - cents) / 100 };
}

// Reversal is a single server transaction. Never split expense/payment deletes
// across browser requests: a refresh, retry, or concurrent undo can corrupt money.
export async function reverseStandaloneDeduction({ payment, companyId, invoke }) {
  const read = (key) => payment?.[key] ?? payment?.data?.[key];
  const standalone = Boolean(read('withheld_expense_id')) ||
    String(read('notes') || '').toLowerCase().includes('deducted from payment, no cash received');
  if (!standalone) return { handled: false };
  if (!companyId || read('company_id') !== companyId || !payment?.id) {
    throw new Error('This deduction does not belong to the active company.');
  }
  const response = await invoke('undoStandaloneFeeDeduction', { paymentId: payment.id, companyId });
  const result = response?.data ?? response;
  if (result?.success !== true) {
    throw new Error(result?.error || 'The deduction could not be reversed. No successful reversal was confirmed.');
  }
  return { ...result, handled: true };
}