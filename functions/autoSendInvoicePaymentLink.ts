import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Auto-triggered when CrewCam photos are uploaded
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { inspection_job_id, company_id } = await req.json();

    if (!inspection_job_id || !company_id) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log('🔔 CrewCam completion detected:', inspection_job_id);

    // Get inspection job
    const jobs = await base44.asServiceRole.entities.InspectionJob.filter({ id: inspection_job_id });
    const job = jobs[0];

    if (!job || !job.customer_id) {
      return Response.json({ error: 'Job or customer not found' }, { status: 404 });
    }

    // Get customer
    const customers = await base44.asServiceRole.entities.Customer.filter({ id: job.customer_id });
    const customer = customers[0];

    if (!customer || !customer.phone) {
      return Response.json({ error: 'Customer phone not found' }, { status: 404 });
    }

    // Check if invoice already exists
    let invoice;
    const existingInvoices = await base44.asServiceRole.entities.Invoice.filter({ 
      related_inspection_job_id: inspection_job_id 
    });

    if (existingInvoices.length > 0) {
      invoice = existingInvoices[0];
      console.log('✅ Found existing invoice:', invoice.invoice_number);
    } else {
      // Create invoice from job
      const invoiceNumber = `INV-${Date.now()}`;
      
      invoice = await base44.asServiceRole.entities.Invoice.create({
        company_id: company_id,
        invoice_number: invoiceNumber,
        customer_id: job.customer_id,
        customer_name: customer.name,
        customer_email: customer.email,
        amount: job.total_amount || 0,
        status: 'sent',
        issue_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        items: job.line_items || [],
        notes: `Completion photos attached. Job: ${job.job_number}`,
        related_inspection_job_id: inspection_job_id
      });

      console.log('✅ Created invoice:', invoiceNumber);
    }

    // Generate payment link
    const paymentLinkResult = await base44.asServiceRole.functions.invoke('createPaymentLinkForInvoice', {
      invoice_id: invoice.id
    });

    if (!paymentLinkResult.data?.success) {
      throw new Error('Failed to create payment link');
    }

    const paymentUrl = paymentLinkResult.data.payment_url;

    // Get latest photo from job
    const photos = job.photos || [];
    const latestPhoto = photos[photos.length - 1];

    // Send SMS with photo and payment link
    const smsMessage = `✅ Your roof is complete! 

See the final result: ${latestPhoto?.url || 'Photo attached'}

Invoice #${invoice.invoice_number}
Amount: $${invoice.amount.toFixed(2)}

Pay now: ${paymentUrl}

Questions? Reply to this message.`;

    await base44.asServiceRole.functions.invoke('sendSMS', {
      to: customer.phone,
      message: smsMessage,
      contactName: customer.name,
      companyId: company_id
    });

    console.log('✅ Sent payment SMS to:', customer.phone);

    // Also send email if available
    if (customer.email) {
      await base44.asServiceRole.functions.invoke('sendInvoiceEmail', {
        invoice_id: invoice.id,
        include_payment_link: true
      });
    }

    return Response.json({
      success: true,
      invoice_id: invoice.id,
      payment_url: paymentUrl,
      sms_sent: true,
      email_sent: !!customer.email
    });

  } catch (error) {
    console.error('❌ Error auto-sending invoice:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});