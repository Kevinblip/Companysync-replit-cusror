import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messageNumber } = await req.json();
    const testNumber = messageNumber || 1;
    
    const phone = '+12163318323';
    const email = 'yicnteam@gmail.com';
    
    // Send test email
    await base44.integrations.Core.SendEmail({
      to: email,
      subject: `🧪 Test Automation Message #${testNumber} of 5`,
      body: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Test Automation Message #${testNumber}</h2>
          <p>This is test message <strong>${testNumber} of 5</strong> from your automation system.</p>
          <p>Time sent: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
          <hr>
          <p style="color: #666;">This confirms your automation system is working correctly!</p>
        </div>
      `
    });

    // Send test SMS using existing sendSMS function
    try {
      await base44.functions.invoke('sendSMS', {
        to: phone,
        message: `🧪 Test #${testNumber}/5 - Automation working! Sent at ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`,
        contactName: 'Test Automation',
        companyId: '695944e3c1fb00b7ab716c6f' // CompanySync
      });
    } catch (smsErr) {
      console.error('SMS failed:', smsErr);
    }

    return Response.json({ 
      success: true, 
      message: `Test message #${testNumber} sent to ${email} and ${phone}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Test automation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});