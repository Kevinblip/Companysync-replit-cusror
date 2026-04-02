import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const { event, data } = await req.json();
    
    // Only process company creation events
    if (event?.type !== 'create' || event?.entity_name !== 'Company') {
      return Response.json({ success: true, skipped: true, reason: 'Not a company creation event' });
    }
    
    const company = data;
    
    if (!company || !company.email) {
      return Response.json({ success: false, error: 'No company email found' });
    }
    
    const companyName = company.company_name || 'Your Company';
    const recipientEmail = company.email;
    const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
    
    const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .features { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .feature { padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .feature:last-child { border-bottom: none; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Welcome to CompanySync!</h1>
    </div>
    <div class="content">
      <h2>Hi ${companyName}!</h2>
      <p>Thank you for joining CompanySync! We're thrilled to have you on board.</p>
      <p>Your account is all set up and ready to go. Here's what you can do next:</p>
      
      <div class="features">
        <div class="feature">✅ <strong>AI Estimator</strong> - Generate accurate roof estimates in seconds</div>
        <div class="feature">✅ <strong>Lexi AI Assistant</strong> - Your intelligent business helper</div>
        <div class="feature">✅ <strong>Lead Management</strong> - Track and convert leads efficiently</div>
        <div class="feature">✅ <strong>Customer Portal</strong> - Delight your customers with transparency</div>
        <div class="feature">✅ <strong>Invoicing & Payments</strong> - Get paid faster</div>
      </div>
      
      <p style="text-align: center;">
        <a href="${appUrl}" class="button">Sign In to Your Account →</a>
      </p>
      
      <p>If you have any questions, just reply to this email – we're here to help!</p>
      
      <p>Welcome aboard! 🚀<br>
      <strong>The CompanySync Team</strong></p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} CompanySync. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
    
    // Send the welcome email using Core integration
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: recipientEmail,
      subject: `🎉 Welcome to CompanySync, ${companyName}!`,
      body: emailBody,
      from_name: 'CompanySync'
    });
    
    console.log(`✅ Welcome email sent to ${recipientEmail} for company: ${companyName}`);
    
    return Response.json({ 
      success: true, 
      message: `Welcome email sent to ${recipientEmail}` 
    });
    
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});