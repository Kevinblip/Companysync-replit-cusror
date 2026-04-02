import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { paymentId, companyId } = await req.json();

    if (!paymentId) {
      return Response.json({ error: 'Payment ID is required' }, { status: 400 });
    }

    // Fetch payment details
    const payments = await base44.asServiceRole.entities.Payment.filter({ id: paymentId });
    const payment = payments[0];

    if (!payment) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Fetch company details for branding
    let company = null;
    if (companyId) {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
      company = companies[0];
    }

    // Get customer email - check payment first, then look up customer
    let customerEmail = payment.customer_email;
    
    if (!customerEmail && payment.customer_id) {
      const customers = await base44.asServiceRole.entities.Customer.filter({ id: payment.customer_id });
      if (customers[0]?.email) {
        customerEmail = customers[0].email;
      }
    }
    
    if (!customerEmail && payment.customer_name) {
      const customers = await base44.asServiceRole.entities.Customer.filter({ name: payment.customer_name });
      if (customers[0]?.email) {
        customerEmail = customers[0].email;
      }
    }
    
    if (!customerEmail) {
      console.log('⚠️ No customer email found, skipping notification');
      return Response.json({ 
        success: false, 
        message: 'No customer email available' 
      });
    }

    const companyName = company?.company_name || 'Our Company';
    const companyPhone = company?.phone_number || '';
    const companyEmail = company?.email_address || '';
    
    const formattedAmount = `$${payment.amount.toFixed(2)}`;
    const paymentDate = payment.payment_date 
      ? new Date(payment.payment_date).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })
      : new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });

    const subject = `Payment Receipt - ${payment.payment_number || 'Payment Confirmation'}`;
    
    const message = `
Dear ${payment.customer_name},

Thank you for your payment! This email confirms that we have received your payment.

PAYMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Payment Number: ${payment.payment_number || 'N/A'}
Amount Paid: ${formattedAmount}
Payment Method: ${payment.payment_method || 'N/A'}
Payment Date: ${paymentDate}
${payment.invoice_number ? `Invoice Number: ${payment.invoice_number}` : ''}
${payment.reference_number ? `Reference Number: ${payment.reference_number}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${payment.notes ? `\nNotes: ${payment.notes}\n` : ''}

This serves as your official payment receipt. Please keep this email for your records.

If you have any questions about this payment, please don't hesitate to contact us.

Best regards,
${companyName}
${companyPhone ? `Phone: ${companyPhone}` : ''}
${companyEmail ? `Email: ${companyEmail}` : ''}
    `.trim();

    // Send email notification (prefer Resend for external recipients)
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: `${companyName} <noreply@mycrewcam.com>`,
          to: customerEmail,
          subject: subject,
          html: message.replace(/\n/g, '<br/>')
        });
        console.log('✅ Payment notification sent via Resend to:', customerEmail);
      } catch (e) {
        console.error('⚠️ Resend failed, falling back to Core.SendEmail:', e?.message || e);
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: companyName,
          to: customerEmail,
          subject: subject,
          body: message
        });
        console.log('✅ Payment notification sent via Core.SendEmail to:', customerEmail);
      }
    } else {
      await base44.asServiceRole.integrations.Core.SendEmail({
        from_name: companyName,
        to: customerEmail,
        subject: subject,
        body: message
      });
      console.log('✅ Payment notification sent via Core.SendEmail to:', customerEmail);
    }

    return Response.json({
      success: true,
      message: 'Payment notification sent successfully',
      recipient: customerEmail
    });

  } catch (error) {
    console.error('❌ Error sending payment notification:', error);
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});