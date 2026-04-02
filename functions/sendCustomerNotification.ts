import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  console.log('👤 ========== CUSTOMER NOTIFICATION STARTED ==========');
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.log('✅ User authenticated:', user.email);

    const body = await req.json();
    const { customer, companyId, assigneeEmails } = body;

    if (!customer || !companyId) {
      return Response.json({ 
        error: 'Missing required fields: customer, companyId' 
      }, { status: 400 });
    }

    // Get company info
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];

    // Get all staff for this company
    const allStaffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId });
    const adminEmails = allStaffProfiles.filter(s => s.is_administrator).map(s => s.user_email);

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

    const assigneeNames = (assigneeEmails || [])
      .map(email => {
        const staff = allStaffProfiles.find(s => s.user_email === email);
        return staff?.full_name || email;
      })
      .join(', ');

    // Send to assignees
    if (assigneeEmails && assigneeEmails.length > 0) {
      for (const email of assigneeEmails) {
        try {
          console.log(`📧 Sending to assignee ${email}`);

          const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .customer-box { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .table th { background: #f3f4f6; padding: 10px; text-align: left; }
    .table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; border-radius: 0 0 10px 10px; margin-top: 20px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #dbeafe; color: #1e40af; }
  </style>
</head>
<body>
  <div class="header">
    ${company?.logo_url ? `<img src="${company.logo_url}" alt="${company.company_name}" style="max-width: 120px; margin-bottom: 10px;">` : ''}
    <h1>👤 New Customer Assigned</h1>
  </div>
  
  <div class="content">
    <div class="customer-box">
      <span class="badge">✅ ASSIGNED TO YOU</span>
      <h2 style="margin: 15px 0 5px 0; color: #1e40af;">${customer.name}</h2>
      ${customer.company ? `<p style="margin: 0; color: #6b7280;">${customer.company}</p>` : ''}
    </div>
    
    <h3>Customer Details:</h3>
    <table class="table">
      ${customer.email ? `
      <tr>
        <th>Email</th>
        <td><a href="mailto:${customer.email}">${customer.email}</a></td>
      </tr>` : ''}
      ${customer.phone ? `
      <tr>
        <th>Phone</th>
        <td><a href="tel:${customer.phone}">${customer.phone}</a></td>
      </tr>` : ''}
      ${customer.address || customer.street ? `
      <tr>
        <th>Address</th>
        <td>${customer.street || customer.address || 'Not provided'}</td>
      </tr>` : ''}
      ${customer.source ? `
      <tr>
        <th>Source</th>
        <td>${customer.source}</td>
      </tr>` : ''}
    </table>
    
    <p style="margin-top: 30px; color: #666; font-size: 14px;">
      <strong>Created by:</strong> ${user.full_name || user.email}
    </p>
  </div>
  
  <div class="footer">
    <p><strong>${company?.company_name || 'CRM'}</strong></p>
    ${company?.phone ? `<p>📞 ${company.phone}</p>` : ''}
    ${company?.email ? `<p>📧 ${company.email}</p>` : ''}
  </div>
</body>
</html>`;

          const emailResult = await resend.emails.send({
            from: fromEmail,
            to: email,
            subject: `👤 New Customer Assigned: ${customer.name}`,
            html: htmlBody
          });

          console.log(`✅ Email sent to ${email}:`, emailResult.data?.id);

          // Bell notification
          await base44.asServiceRole.entities.Notification.create({
            company_id: companyId,
            user_email: email,
            title: '👤 New Customer Assigned',
            message: `You've been assigned to customer: ${customer.name}`,
            type: 'customer_created',
            related_entity_type: 'Customer',
            related_entity_id: customer.id,
            link_url: '/customer-profile?id=' + customer.id,
            is_read: false
          });

          successCount++;
        } catch (error) {
          console.error(`❌ Failed to notify ${email}:`, error);
          errorCount++;
          errors.push({ email, error: error.message });
        }
      }
    }

    // Send to ALL admins (even if they're assignees, they get both emails)
    for (const adminEmail of adminEmails) {

      try {
        console.log(`📧 Sending to admin ${adminEmail}`);

        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .customer-box { background: #f3f4f6; border-left: 4px solid #6b7280; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .table th { background: #f3f4f6; padding: 10px; text-align: left; }
    .table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; border-radius: 0 0 10px 10px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    ${company?.logo_url ? `<img src="${company.logo_url}" alt="${company.company_name}" style="max-width: 120px; margin-bottom: 10px;">` : ''}
    <h1>👤 New Customer Created</h1>
  </div>
  
  <div class="content">
    <div class="customer-box">
      <h2 style="margin: 0 0 5px 0; color: #374151;">${customer.name}</h2>
      ${customer.company ? `<p style="margin: 0; color: #6b7280;">${customer.company}</p>` : ''}
      ${assigneeNames ? `<p style="margin: 10px 0 0 0; font-size: 14px; color: #6b7280;"><strong>Assigned to:</strong> ${assigneeNames}</p>` : ''}
    </div>
    
    <h3>Customer Details:</h3>
    <table class="table">
      ${customer.email ? `
      <tr>
        <th>Email</th>
        <td><a href="mailto:${customer.email}">${customer.email}</a></td>
      </tr>` : ''}
      ${customer.phone ? `
      <tr>
        <th>Phone</th>
        <td><a href="tel:${customer.phone}">${customer.phone}</a></td>
      </tr>` : ''}
      ${customer.address || customer.street ? `
      <tr>
        <th>Address</th>
        <td>${customer.street || customer.address || 'Not provided'}</td>
      </tr>` : ''}
      ${customer.source ? `
      <tr>
        <th>Source</th>
        <td>${customer.source}</td>
      </tr>` : ''}
    </table>
    
    <p style="margin-top: 30px; color: #666; font-size: 14px;">
      <strong>Created by:</strong> ${user.full_name || user.email}
    </p>
  </div>
  
  <div class="footer">
    <p><strong>${company?.company_name || 'CRM'}</strong></p>
    ${company?.phone ? `<p>📞 ${company.phone}</p>` : ''}
    ${company?.email ? `<p>📧 ${company.email}</p>` : ''}
  </div>
</body>
</html>`;

        const emailResult = await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          subject: `👤 New Customer Created: ${customer.name}`,
          html: htmlBody
        });

        console.log(`✅ Email sent to admin ${adminEmail}:`, emailResult.data?.id);

        // Bell notification
        await base44.asServiceRole.entities.Notification.create({
          company_id: companyId,
          user_email: adminEmail,
          title: '👤 New Customer Created',
          message: `New customer: ${customer.name}${assigneeNames ? ` (assigned to ${assigneeNames})` : ''}`,
          type: 'customer_created',
          related_entity_type: 'Customer',
          related_entity_id: customer.id,
          link_url: '/customer-profile?id=' + customer.id,
          is_read: false
        });

        successCount++;
      } catch (error) {
        console.error(`❌ Failed to notify admin ${adminEmail}:`, error);
        errorCount++;
        errors.push({ email: adminEmail, error: error.message });
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
    console.error('❌ CRITICAL ERROR in sendCustomerNotification:');
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);
    
    return Response.json({ 
      success: false,
      error: 'Failed to send customer notifications',
      details: error.message
    }, { status: 500 });
  }
});