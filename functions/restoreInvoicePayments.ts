import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

function cents(n) { return Math.round((n || 0) * 100); }
function toDollars(c) { return Math.round(c) / 100; }

async function generateNextPaymentNumber(base44) {
  const year = new Date().getFullYear();
  const payments = await base44.asServiceRole.entities.Payment.list('-created_date', 1000);
  const numbers = payments
    .map((p) => p.payment_number)
    .filter((num) => num && String(num).startsWith(`PAY-${year}-`))
    .map((num) => parseInt(String(num).replace(/PAY-\d{4}-|[^\d]/g, '')))
    .filter((n) => !isNaN(n));
  const nextSeq = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `PAY-${year}-${String(nextSeq).padStart(4, '0')}`;
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
    } catch (err) {
      body = {};
    }

    const invoiceNumbers = Array.isArray(body?.invoice_numbers) && body.invoice_numbers.length > 0
      ? body.invoice_numbers
      : [];

    if (invoiceNumbers.length === 0) {
      return Response.json({ error: 'invoice_numbers is required (array of invoice_number strings)' }, { status: 400 });
    }

    const results = [];

    for (const invNumber of invoiceNumbers) {
      // 1) Load invoice
      const invList = await base44.asServiceRole.entities.Invoice.filter({ invoice_number: invNumber });
      const invoice = invList[0];
      if (!invoice) {
        results.push({ invoice_number: invNumber, success: false, error: 'Invoice not found' });
        continue;
      }

      // 2) Load all payments linked by id or number, and RE-LINK by customer if mismatched
      const byId = await base44.asServiceRole.entities.Payment.filter({ invoice_id: invoice.id });
      const byNum = await base44.asServiceRole.entities.Payment.filter({ invoice_number: invNumber });
      const byCustomer = await base44.asServiceRole.entities.Payment.filter({ customer_name: invoice.customer_name, status: 'received' });

      // Any received payments for this customer that are missing/incorrect invoice linkage → reassign to this invoice
      for (const p of byCustomer) {
        const needsRelink = !p.invoice_id || p.invoice_id !== invoice.id || !p.invoice_number || p.invoice_number !== invoice.invoice_number;
        if (needsRelink) {
          await base44.asServiceRole.entities.Payment.update(p.id, {
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
          });
        }
      }

      const all = [...byId, ...byNum, ...byCustomer].filter(Boolean);
      const unique = all.filter((p, i, self) => i === self.findIndex((t) => t.id === p.id));
      const received = unique.filter((p) => p.status === 'received');

      const totalC = cents(invoice.amount || 0);
      const paidC = received.reduce((s, p) => s + cents(p.amount || 0), 0);

      const actions = [];

      // Helper to create a payment for a given amountC
      const createPaymentFor = async (amountC) => {
        const payment_number = await generateNextPaymentNumber(base44);
        const payment = await base44.asServiceRole.entities.Payment.create({
          company_id: invoice.company_id,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          customer_id: undefined,
          customer_name: invoice.customer_name,
          customer_email: invoice.customer_email,
          amount: toDollars(amountC),
          payment_method: 'cash',
          payment_number,
          payment_date: (invoice.issue_date || new Date().toISOString()).split('T')[0],
          status: 'received',
        });
        actions.push({ action: 'create_payment', amount: payment.amount, payment_number });
        return payment;
      };

      // Case A: already 2 or more received payments -> just ensure invoice summary is correct
      if (received.length >= 2) {
        const newPaidC = received.reduce((s, p) => s + cents(p.amount || 0), 0);
        const newStatus = newPaidC >= totalC && totalC > 0 ? 'paid' : newPaidC > 0 ? 'partially_paid' : invoice.status || 'draft';
        await base44.asServiceRole.entities.Invoice.update(invoice.id, { amount_paid: toDollars(newPaidC), status: newStatus });
        results.push({ invoice_number: invNumber, success: true, note: 'Already had 2+ payments; invoice totals refreshed', actions });
        continue;
      }

      // Case B: exactly 1 received payment
      if (received.length === 1) {
        const p0 = received[0];
        const p0C = cents(p0.amount || 0);

        if (Math.abs(p0C - totalC) <= 1) {
          // One full payment exists: split into two halves
          const half1 = Math.floor(totalC / 2);
          const half2 = totalC - half1;
          await base44.asServiceRole.entities.Payment.update(p0.id, { amount: toDollars(half1) });
          actions.push({ action: 'update_payment', payment_number: p0.payment_number, old_amount: toDollars(p0C), new_amount: toDollars(half1) });
          await createPaymentFor(half2);
        } else {
          // One partial payment exists: create the remaining as a second payment
          const remainingC = Math.max(0, totalC - p0C);
          if (remainingC > 0) {
            await createPaymentFor(remainingC);
          }
        }

        const refreshedList = await base44.asServiceRole.entities.Payment.filter({ invoice_id: invoice.id });
        const refreshedReceived = refreshedList
          .filter((p) => p.status === 'received')
          .map((p) => ({ ...p, amount: Number(p.amount) || 0 }))
          .filter((p) => p.amount > 0);
        const newPaidC = refreshedReceived.reduce((s, p) => s + cents(p.amount || 0), 0);
        const newStatus = newPaidC >= totalC && totalC > 0 ? 'paid' : newPaidC > 0 ? 'partially_paid' : invoice.status || 'draft';
        await base44.asServiceRole.entities.Invoice.update(invoice.id, { amount_paid: toDollars(newPaidC), status: newStatus });

        results.push({ invoice_number: invNumber, success: true, actions });
        continue;
      }

      // Case C: no received payments -> create two payments (even split)
      if (received.length === 0) {
        if (totalC <= 0) {
          results.push({ invoice_number: invNumber, success: false, error: 'Invoice amount is zero; cannot create payments' });
          continue;
        }
        const half1 = Math.floor(totalC / 2);
        const half2 = totalC - half1;
        await createPaymentFor(half1);
        await createPaymentFor(half2);

        // Update invoice
        await base44.asServiceRole.entities.Invoice.update(invoice.id, { amount_paid: toDollars(totalC), status: 'paid' });
        results.push({ invoice_number: invNumber, success: true, actions });
        continue;
      }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});