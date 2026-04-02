import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { invoice_number, customer_name } = await req.json();
    if (!invoice_number || !customer_name) {
      return Response.json({ error: 'invoice_number and customer_name are required' }, { status: 400 });
    }

    const invList = await base44.asServiceRole.entities.Invoice.filter({ invoice_number });
    const invoice = invList[0];
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 });

    const payments = await base44.asServiceRole.entities.Payment.filter({ customer_name, status: 'received' });
    let relinked = 0;
    for (const p of payments) {
      if (p.invoice_id !== invoice.id || p.invoice_number !== invoice.invoice_number) {
        await base44.asServiceRole.entities.Payment.update(p.id, {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
        });
        relinked++;
      }
    }

    // Recalc invoice
    const refreshed = await base44.asServiceRole.entities.Payment.filter({ invoice_id: invoice.id, status: 'received' });
    const amount_paid = refreshed.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const status = amount_paid >= (Number(invoice.amount) || 0) && invoice.amount > 0 ? 'paid' : amount_paid > 0 ? 'partially_paid' : invoice.status || 'draft';
    await base44.asServiceRole.entities.Invoice.update(invoice.id, { amount_paid, status });

    return Response.json({ success: true, relinked, amount_paid, status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});