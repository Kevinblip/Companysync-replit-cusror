import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

function requireCronAuth(req) {
  const token = Deno.env.get('CRON_SECRET_TOKEN');
  if (!token) return { ok: true };
  const header = req.headers.get('Authorization');
  if (!header || header.replace('Bearer ', '') !== token) {
    return { ok: false, res: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  try {
    const auth = requireCronAuth(req);
    if (!auth.ok) return auth.res;

    const base44 = createClientFromRequest(req);

    // Iterate all companies
    const companies = await base44.asServiceRole.entities.Company.list();
    let created = 0;

    for (const company of companies) {
      // Get paid invoices recently updated (last 45 days)
      const invoices = await base44.asServiceRole.entities.Invoice.filter({ company_id: company.id });
      const paidInvoices = invoices.filter(i => i.status === 'paid');

      // Existing requests map by invoice id
      const existing = await base44.asServiceRole.entities.ReviewRequest.filter({ company_id: company.id });
      const existingByInvoice = new Set(existing.map(r => r.invoice_id).filter(Boolean));

      for (const inv of paidInvoices) {
        if (existingByInvoice.has(inv.id)) continue;
        const customerName = inv.customer_name || 'Customer';
        const customerEmail = inv.customer_email || '';
        // Try to find customer phone
        let customerPhone = '';
        if (inv.customer_id) {
          const custArr = await base44.asServiceRole.entities.Customer.filter({ id: inv.customer_id });
          if (custArr[0]?.phone) customerPhone = custArr[0].phone;
        }

        // Determine sales rep
        let repEmail = inv.sale_agent || null;
        let repName = inv.sale_agent_name || null;
        if (!repEmail && Array.isArray(inv.commission_splits) && inv.commission_splits.length > 0) {
          repEmail = inv.commission_splits[0].user_email;
          repName = inv.commission_splits[0].user_name || repEmail;
        }

        // Lookup staff profile for nice name if needed
        if (repEmail && !repName) {
          const staff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: repEmail });
          if (staff[0]?.full_name) repName = staff[0].full_name;
        }

        // Create pending approval review request
        const rr = await base44.asServiceRole.entities.ReviewRequest.create({
          company_id: company.id,
          customer_id: inv.customer_id,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          sale_agent_email: repEmail,
          sale_agent_name: repName,
          status: 'pending_approval',
          total_sent_count: 0,
          message_variant_index: 0,
        });
        created++;

        // Notify the rep to approve
        if (repEmail) {
          await base44.asServiceRole.entities.Notification.create({
            company_id: company.id,
            user_email: repEmail,
            title: 'Review request approval needed',
            message: `Approve Google review request for ${customerName} (Invoice ${inv.invoice_number})`,
            type: 'review_request',
            related_entity_type: 'ReviewRequest',
            related_entity_id: rr.id,
            link_url: '/ReviewRequests',
            is_read: false
          });
        }
      }
    }

    return Response.json({ status: 'ok', created });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});