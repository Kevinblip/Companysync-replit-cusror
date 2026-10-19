import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

function toISODate(d = new Date()) {
  const dt = new Date(d);
  return dt.toISOString().split('T')[0];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch (_e) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      estimate_number,
      due_days = 30,
      email_customer = false,
      max_apply_payment = null, // optional cap for applied payments
    } = body || {};

    if (!estimate_number) {
      return Response.json({ error: 'estimate_number is required' }, { status: 400 });
    }

    // 1) Find the estimate across companies (service role to avoid user-scoped limits)
    const estimates = await base44.asServiceRole.entities.Estimate.filter({ estimate_number }, '-created_date', 100);
    const estimate = estimates[0];
    if (!estimate) {
      return Response.json({ error: `Estimate ${estimate_number} not found` }, { status: 404 });
    }

    const companyId = estimate.company_id;

    // 2) Preserve only the estimate's explicit, same-company customer link.
    let customerId = null;
    let customerEmail = estimate.customer_email || null;
    if (estimate.customer_id) {
      try {
        const customers = await base44.asServiceRole.entities.Customer.filter({
          id: estimate.customer_id,
          company_id: companyId,
        }, '-created_date', 1);
        const linkedCustomer = customers.find((customer) => String(customer.id) === String(estimate.customer_id));
        if (linkedCustomer) {
          customerId = linkedCustomer.id;
          customerEmail = linkedCustomer.email || customerEmail;
        }
      } catch (_e) {
        // An unresolved relationship stays unlinked; never guess by name.
      }
    }

    // 3) Build items from estimate. The Adjustment field is not a line on the
    // estimate, so copy it across as one line and include it in the total once.
    const items = Array.isArray(estimate.items) ? estimate.items.map((it) => ({
      description: it.description || it.long_description || it.code || 'Item',
      quantity: it.quantity || 1,
      rate: it.rate || (it.amount && it.quantity ? (Number(it.amount) / Number(it.quantity)) : undefined),
      amount: it.amount || (it.rate && it.quantity ? Number(it.rate) * Number(it.quantity) : 0),
    })) : [];

    const adjustmentAmount = Number(estimate.adjustment_amount ?? estimate.data?.adjustment_amount) || 0;
    const adjustmentLabel = String(estimate.adjustment_label || estimate.data?.adjustment_label || '').trim();
    const alreadyHasAdjustment = items.some((it) => it.code === 'ESTIMATE_ADJUSTMENT' || /^adjustment$/i.test(String(it.description || '')) || /^adjustment\s*:/i.test(String(it.description || '')));
    if (adjustmentAmount !== 0 && !alreadyHasAdjustment) {
      items.push({
        description: adjustmentLabel ? `Adjustment: ${adjustmentLabel}` : 'Adjustment',
        quantity: 1,
        rate: adjustmentAmount,
        amount: adjustmentAmount,
        code: 'ESTIMATE_ADJUSTMENT',
      });
    }

    const itemsSum = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    let totalAmount = Number(estimate.amount) || Number(estimate.total_amount) || itemsSum;
    const withoutAdjustment = itemsSum - adjustmentAmount;
    if (adjustmentAmount !== 0 && Math.abs(totalAmount - withoutAdjustment) < 0.02) {
      totalAmount = itemsSum;
    }

    // 4) Generate invoice_number (INV-YYYY-####).
    // Base44 has no per-company advisory lock. The Postgres handlers in
    // CompanySync allocate atomically; this path only matches that shape
    // and skips labels already present in the fetched list.
    const year = new Date().getFullYear();
    let invoiceNumber = `INV-${year}-0001`;
    try {
      const invoices = await base44.asServiceRole.entities.Invoice.filter({ company_id: companyId }, '-created_date', 5000);
      const taken = new Set<string>();
      let maxSeq = 0;
      for (const inv of invoices) {
        const number = String(inv.invoice_number || '').trim();
        if (!number) continue;
        taken.add(number.toLowerCase());
        const withYear = /^INV-(\d{4})-(\d+)$/.exec(number);
        if (withYear) {
          if (Number(withYear[1]) === year && withYear[2].length <= 9) {
            maxSeq = Math.max(maxSeq, Number(withYear[2]));
          }
          continue;
        }
        const legacy = /^INV-(\d+)$/.exec(number);
        if (legacy && legacy[1].length <= 9) maxSeq = Math.max(maxSeq, Number(legacy[1]));
      }
      let sequence = maxSeq + 1;
      invoiceNumber = `INV-${year}-${String(sequence).padStart(4, '0')}`;
      while (taken.has(invoiceNumber.toLowerCase()) && sequence < maxSeq + 10000) {
        sequence += 1;
        invoiceNumber = `INV-${year}-${String(sequence).padStart(4, '0')}`;
      }
    } catch (_e) {}

    const issueDate = toISODate(new Date());
    const dueDate = toISODate(addDays(new Date(), due_days));

    // 5) Create invoice (initially as 'sent')
    const invoiceData = {
      company_id: companyId,
      invoice_number: invoiceNumber,
      customer_id: customerId || undefined,
      customer_name: estimate.customer_name,
      customer_email: customerEmail || estimate.customer_email || undefined,
      amount: totalAmount,
      amount_paid: 0,
      status: 'sent',
      issue_date: issueDate,
      due_date: dueDate,
      currency: estimate.currency || 'USD',
      notes: estimate.notes || undefined,
      items,
    };

    const newInvoice = await base44.asServiceRole.entities.Invoice.create(invoiceData);

    // 6) Link existing payments (unlinked for this customer) and apply up to invoice amount (or cap)
    let appliedTotal = 0;
    try {
      let payments = await base44.asServiceRole.entities.Payment.filter({ company_id: companyId }, '-payment_date', 5000);
      payments = payments.filter((p) => 
        customerId &&
        String(p.customer_id || '') === String(customerId) &&
        p.status === 'received' &&
        !p.invoice_id // unlinked only
      );

      // sort oldest first to link chronologically
      payments.sort((a, b) => new Date(a.payment_date || a.created_date) - new Date(b.payment_date || b.created_date));

      const cap = typeof max_apply_payment === 'number' ? max_apply_payment : Number.POSITIVE_INFINITY;

      for (const p of payments) {
        if (appliedTotal >= totalAmount || appliedTotal >= cap) break;
        const remainingToApply = Math.min(totalAmount - appliedTotal, cap - appliedTotal);
        const amt = Math.min(Number(p.amount) || 0, remainingToApply);
        if (amt <= 0) continue;

        await base44.asServiceRole.entities.Payment.update(p.id, {
          invoice_id: newInvoice.id,
          invoice_number: newInvoice.invoice_number,
        });

        appliedTotal += amt;
      }
    } catch (_e) {}

    // 7) Update invoice status based on appliedTotal
    let newStatus = 'sent';
    if (appliedTotal >= totalAmount) newStatus = 'paid';
    else if (appliedTotal > 0) newStatus = 'partially_paid';

    const updatedInvoice = await base44.asServiceRole.entities.Invoice.update(newInvoice.id, {
      amount_paid: appliedTotal,
      status: newStatus,
    });

    // 8) Optionally email the customer (off by default per request)
    if (email_customer && updatedInvoice.customer_email) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: updatedInvoice.customer_email,
          from_name: 'Billing',
          subject: `Invoice ${updatedInvoice.invoice_number}`,
          body: `Hello ${updatedInvoice.customer_name || ''},\n\nPlease find your invoice ${updatedInvoice.invoice_number} for $${Number(updatedInvoice.amount).toFixed(2)}.\n\nThank you!`,
        });
      } catch (_e) {
        // Ignore email errors; invoice creation succeeded
      }
    }

    return Response.json({
      success: true,
      estimate_number,
      invoice: { ...updatedInvoice, applied_payments_total: appliedTotal },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
});