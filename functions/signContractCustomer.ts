import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  console.log('🔍 === signContractCustomer called ===');
  console.log('📥 Request method:', req.method);
  console.log('📥 Request URL:', req.url);
  
  try {
    // Don't require auth - this is for external customers
    const base44 = createClientFromRequest(req);
    
    // Log raw body
    const rawBody = await req.text();
    console.log('📦 Raw body received:', rawBody);
    
    // Try to parse JSON
    let body;
    try {
      body = JSON.parse(rawBody);
      console.log('✅ Parsed JSON body:', JSON.stringify(body, null, 2));
    } catch (e) {
      console.error('❌ Failed to parse JSON:', e.message);
      return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }
    
    // Extract data from all possible locations
    const token = body.token || body?.body?.token || body?.data?.token;
    const fields = body.fields || body?.body?.fields || body?.data?.fields;
    const signature = body.signature || body?.body?.signature || body?.data?.signature;
    
    console.log('🎫 Extracted token:', token);
    console.log('📝 Extracted fields:', fields ? 'present' : 'missing');
    console.log('✍️ Extracted signature:', signature ? 'present (length: ' + signature.length + ')' : 'missing');

    if (!token || !signature) {
      console.error('❌ Missing required data - token:', !!token, 'signature:', !!signature);
      return Response.json({ success: false, error: 'Token and signature required' }, { status: 400 });
    }

    console.log('🔎 Querying session with token:', token);
    const sessions = await base44.asServiceRole.entities.ContractSigningSession.filter({ signing_token: token });
    console.log('📊 Found sessions:', sessions.length);
    
    if (!sessions || sessions.length === 0) {
      console.error('❌ No session found for token:', token);
      return Response.json({ success: false, error: 'Invalid signing link' }, { status: 404 });
    }

    const session = sessions[0];
    console.log('✅ Found session ID:', session.id);
    console.log('📋 Session status:', session.status);

    if (session.status === 'completed') {
      console.error('❌ Contract already signed');
      return Response.json({ success: false, error: 'Contract already signed' }, { status: 400 });
    }

    console.log('📤 Uploading signature...');
    const blob = await (await fetch(signature)).blob();
    const file = new File([blob], 'customer_signature.png', { type: 'image/png' });
    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    console.log('✅ Signature uploaded:', file_url);

    console.log('💾 Updating session...');
    await base44.asServiceRole.entities.ContractSigningSession.update(session.id, {
      customer_fields: fields || {},
      customer_signature_url: file_url,
      customer_signed_at: new Date().toISOString(),
      status: 'completed',
      completed_at: new Date().toISOString()
    });
    console.log('✅ Session updated');

    // Generate final PDF
    try {
      console.log('📄 Generating PDF...');
      await base44.asServiceRole.functions.invoke('generateSignedPDF', { sessionId: session.id });
      console.log('✅ PDF generated');
    } catch (pdfError) {
      console.error('⚠️ PDF generation failed:', pdfError.message);
    }

    // Notify rep with detailed form data
    try {
      console.log('📧 Sending notification email...');
      
      // Build detailed email body with all filled fields
      let emailBody = `✅ Contract Signed Successfully!\n\n`;
      emailBody += `📋 Contract: ${session.contract_name}\n`;
      emailBody += `📄 Template: ${session.template_name}\n`;
      emailBody += `👤 Customer: ${session.customer_name}\n`;
      emailBody += `📅 Signed at: ${new Date().toLocaleString()}\n\n`;
      
      emailBody += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      emailBody += `📝 CUSTOMER FILLED INFORMATION:\n`;
      emailBody += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (fields && Object.keys(fields).length > 0) {
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
          emailBody += `${fieldName}: ${fieldValue}\n`;
        }
      } else {
        emailBody += `No additional fields filled.\n`;
      }
      
      emailBody += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      emailBody += `✍️ Customer Signature: Captured and saved\n`;
      emailBody += `🔗 View signed contract in CRM under Contracts\n\n`;
      emailBody += `This is an automated notification. The signed contract will be available in your CRM shortly.`;
      
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: session.rep_email,
        subject: `✅ Contract Signed: ${session.contract_name} - ${session.customer_name}`,
        body: emailBody
      });
      console.log('✅ Detailed email sent');
    } catch (emailError) {
      console.error('⚠️ Email failed:', emailError.message);
    }

    console.log('✅ Returning success response');
    return Response.json({ success: true, message: 'Contract signed successfully' });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('❌ Stack:', error.stack);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});