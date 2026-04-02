import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return Response.json({ error: 'Missing invoiceId' }, { status: 400 });
    }

    // Fetch invoice
    const invoices = await base44.entities.Invoice.filter({ id: invoiceId });
    const invoice = invoices[0];
    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Compute paid status (trust status if already paid; otherwise sum payments)
    let isFullyPaid = invoice.status === 'paid';
    if (!isFullyPaid) {
      const payments = await base44.entities.Payment.filter({ invoice_id: invoice.id });
      const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
      isFullyPaid = totalPaid >= (invoice.amount || 0);
    }

    if (!isFullyPaid) {
      return Response.json({ success: false, message: 'Invoice is not fully paid yet. No review request created.' });
    }

    // Avoid duplicates
    const existing = await base44.entities.ReviewRequest.filter({ invoice_id: invoice.id });
    if (existing.length > 0) {
      return Response.json({ success: true, message: 'Review request already exists', review_request_id: existing[0].id });
    }

    // Get customer details
    let customerEmail = invoice.customer_email || '';
    let customerPhone = '';
    if (invoice.customer_id) {
      const customers = await base44.entities.Customer.filter({ id: invoice.customer_id });
      if (customers[0]) {
        customerEmail = customerEmail || customers[0].email || '';
        customerPhone = customers[0].phone || '';
      }
    } else if (invoice.customer_name) {
      const customers = await base44.entities.Customer.filter({ name: invoice.customer_name });
      if (customers[0]) {
        customerEmail = customerEmail || customers[0].email || '';
        customerPhone = customers[0].phone || '';
      }
    }

    // Determine sales rep
    let repEmail = invoice.sale_agent || null;
    let repName = invoice.sale_agent_name || null;
    if (!repEmail && Array.isArray(invoice.commission_splits) && invoice.commission_splits.length > 0) {
      repEmail = invoice.commission_splits[0].user_email;
      repName = invoice.commission_splits[0].user_name || repEmail;
    }
    if (repEmail && !repName) {
      const staff = await base44.entities.StaffProfile.filter({ user_email: repEmail });
      if (staff[0]?.full_name) repName = staff[0].full_name;
    }

    // Fallback to current user so reps always see pending approvals
    if (!repEmail) {
      repEmail = user.email;
      repName = user.full_name || user.email;
    }

    const rr = await base44.entities.ReviewRequest.create({
      company_id: invoice.company_id || null,
      customer_id: invoice.customer_id || null,
      customer_name: invoice.customer_name || 'Customer',
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      sale_agent_email: repEmail || null,
      sale_agent_name: repName || null,
      status: 'approved',
      next_send_at: new Date().toISOString(),
      total_sent_count: 0,
      message_variant_index: 0,
    });

    // Notify sales rep to approve
    if (repEmail) {
      await base44.entities.Notification.create({
        company_id: invoice.company_id || null,
        user_email: repEmail,
        title: 'Review request auto-scheduled',
        message: `We will message ${invoice.customer_name} every 3 days (up to 5) with your Google review link.`,
        type: 'review_request',
        related_entity_type: 'ReviewRequest',
        related_entity_id: rr.id,
        link_url: '/ReviewRequests',
        is_read: false
      });
    }

    return Response.json({ success: true, review_request_id: rr.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});