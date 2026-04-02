import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  console.log('💰 ========== COMMISSION NOTIFICATION STARTED ==========');
  
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.log('✅ User authenticated:', user.email);

    const body = await req.json();
    const { invoiceId, companyId, splits } = body;

    if (!invoiceId || !companyId || !splits || splits.length === 0) {
      return Response.json({ 
        error: 'Missing required fields: invoiceId, companyId, splits' 
      }, { status: 400 });
    }

    // Get invoice details
    const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoiceId });
    const invoice = invoices[0];
    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Get company info
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];

    // Initialize Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return Response.json({ 
        error: 'RESEND_API_KEY not configured' 
      }, { status: 500 });
    }

    const resend = new Resend(resendApiKey);
    const fromName = company?.company_name || 'CRM';
    const fromEmail = `${fromName} <noreply@mycrewcam.com>`;

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Send email to each sales rep
    for (const split of splits) {
      try {
        console.log(`📧 Sending to ${split.user_name} (${split.user_email})`);

        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .split-box { background: #f3e8ff; border-left: 4px solid #8b5cf6; padding: 15px; margin: 20px 0; border-radius: 5px; }
    .amount { font-size: 32px; font-weight: bold; color: #8b5cf6; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .table th { background: #f3f4f6; padding: 10px; text-align: left; }
    .table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; border-radius: 0 0 10px 10px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    ${company?.logo_url ? `<img src="${company.logo_url}" alt="${company.company_name}" style="max-width: 120px; margin-bottom: 10px;">` : ''}
    <h1>💰 Commission Split Assigned</h1>
  </div>
  
  <div class="content">
    <p>Hi <strong>${split.user_name}</strong>,</p>
    
    <p>You've been assigned commission on an invoice:</p>
    
    <div class="split-box">
      <p style="margin: 0; font-size: 14px; color: #666;">Your Split</p>
      <div class="amount">${split.split_percentage}%</div>
      <p style="margin: 10px 0 0 0; font-weight: bold; color: #333;">Role: ${split.role}</p>
    </div>
    
    <h3>Invoice Details:</h3>
    <table class="table">
      <tr>
        <th>Invoice Number</th>
        <td>${invoice.invoice_number}</td>
      </tr>
      <tr>
        <th>Customer</th>
        <td>${invoice.customer_name}</td>
      </tr>
      <tr>
        <th>Invoice Amount</th>
        <td><strong>$${invoice.amount?.toFixed(2)}</strong></td>
      </tr>
      ${invoice.claim_number ? `
      <tr>
        <th>Claim Number</th>
        <td>${invoice.claim_number}</td>
      </tr>` : ''}
    </table>
    
    <h3>All Commission Splits:</h3>
    <table class="table">
      <thead>
        <tr>
          <th>Sales Rep</th>
          <th>Split %</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>
        ${splits.map(s => `
        <tr>
          <td>${s.user_name}</td>
          <td><strong>${s.split_percentage}%</strong></td>
          <td>${s.role}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    
    <p style="margin-top: 30px; color: #666; font-size: 14px;">
      <strong>Updated by:</strong> ${user.full_name || user.email}
    </p>
  </div>
  
  <div class="footer">
    <p><strong>${company?.company_name || 'CRM'}</strong></p>
    ${company?.phone ? `<p>📞 ${company.phone}</p>` : ''}
    ${company?.email ? `<p>📧 ${company.email}</p>` : ''}
  </div>
</body>
</html>`;

        // Send via Resend
        const emailResult = await resend.emails.send({
          from: fromEmail,
          to: split.user_email,
          subject: `💰 Commission Split - Invoice ${invoice.invoice_number}`,
          html: htmlBody
        });

        console.log(`✅ Email sent to ${split.user_email}:`, emailResult.data?.id);

        // Create bell notification
        await base44.asServiceRole.entities.Notification.create({
          company_id: companyId,
          user_email: split.user_email,
          title: '💰 Commission Split Updated',
          message: `You've been assigned ${split.split_percentage}% commission on invoice ${invoice.invoice_number} ($${invoice.amount}) - Role: ${split.role}`,
          type: 'commission_updated',
          related_entity_type: 'Invoice',
          related_entity_id: invoice.id,
          link_url: '/commission-report',
          is_read: false
        });

        console.log(`✅ Bell notification created for ${split.user_email}`);

        successCount++;
      } catch (error) {
        console.error(`❌ Failed to notify ${split.user_email}:`, error);
        errorCount++;
        errors.push({ email: split.user_email, error: error.message });
      }
    }

    console.log(`✅ COMPLETED: ${successCount} sent, ${errorCount} failed`);

    return Response.json({
      success: true,
      message: `Sent ${successCount} notifications (${errorCount} failed)`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ CRITICAL ERROR in sendCommissionNotification:');
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);
    
    return Response.json({ 
      success: false,
      error: 'Failed to send commission notifications',
      details: error.message
    }, { status: 500 });
  }
});