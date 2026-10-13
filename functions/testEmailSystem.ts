import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  console.log('📧 ========== EMAIL SYSTEM TEST ==========');
  
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ User authenticated:', user.email);

    // Parse request
    const body = await req.json();
    const { testEmail } = body;
    
    const emailToTest = testEmail || user.email;

    console.log('📤 Testing email to:', emailToTest);

    // Test 1: Simple email via Base44 Core.SendEmail
    console.log('🧪 Test 1: Sending via Base44 Core.SendEmail...');
    
    try {
      const result = await base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'AI CRM Pro - Email Test',
        to: emailToTest,
        subject: '✅ Email Test - AI CRM Pro',
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #3b82f6;">✅ Email System Test Successful!</h2>
            <p><strong>Test completed at:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Recipient:</strong> ${emailToTest}</p>
            <p><strong>Sent by:</strong> ${user.full_name} (${user.email})</p>
            
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Test Results:</h3>
              <ul>
                <li>✅ Email integration is working</li>
                <li>✅ Authentication successful</li>
                <li>✅ Email sent via Base44 Core.SendEmail</li>
              </ul>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              If you're not receiving emails, check your <strong>spam folder</strong> - that's the #1 most common issue!
            </p>
          </div>
        `
      });

      console.log('✅ Email sent successfully via Core.SendEmail!');
      console.log('📧 Result:', result);

      return Response.json({
        success: true,
        message: `Test email sent to ${emailToTest}`,
        timestamp: new Date().toISOString(),
        result: result,
        instructions: [
          '1. Check your inbox for the test email',
          '2. If not in inbox, CHECK SPAM FOLDER (most common issue)',
          '3. If still not there after 2-3 minutes, there may be an issue with the Base44 email service',
          '4. Try sending to a different email address to see if it\'s email-specific'
        ]
      });

    } catch (emailError) {
      console.error('❌ Email send failed:', emailError);
      console.error('   Message:', emailError.message);
      console.error('   Stack:', emailError.stack);
      
      return Response.json({
        success: false,
        error: 'Email send failed',
        details: emailError.message,
        instructions: [
          'The email integration is not working properly',
          'This could be a Base44 service issue',
          'Check the Base44 dashboard for service status'
        ]
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ CRITICAL ERROR:', error);
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);
    
    return Response.json({
      success: false,
      error: 'System error',
      details: error.message
    }, { status: 500 });
  }
});