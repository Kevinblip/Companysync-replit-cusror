import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Parse the automation payload
        const payload = await req.json();
        const { event, data } = payload;

        // Validation: Only proceed for Lead creation
        if (!data) {
            return Response.json({ message: 'Missing data' });
        }
        
        // Ensure it's a lead (redundant check if automation is set up correctly, but good for safety)
        // Automation payload event: { type: 'create', entity_name: 'Lead', ... }
        
        const firstName = data.name ? data.name.split(' ')[0] : 'there';
        
        // Construct Message
        const companyName = data.company_name || 'our team';
        const bookingUrl = data.booking_url || 'https://getcompanysync.com/book';
        const messageBody = `Hi ${firstName}, 
this is ${companyName}. You recently showed interest in a free roof inspection. 

You can choose a convenient time using this link: ${bookingUrl}`;

        const results = { email: 'skipped', sms: 'skipped' };

        // 1. Send Email
        if (data.email) {
            try {
                await base44.asServiceRole.integrations.Core.SendEmail({
                    to: data.email,
                    subject: `Your Free Roof Inspection | ${companyName}`,
                    body: messageBody,
                    from_name: companyName
                });
                results.email = 'sent';
            } catch (e) {
                console.error('Error sending email:', e);
                results.email = 'failed';
            }
        }

        // 2. Send SMS
        if (data.phone) {
            try {
                // Call the existing sendSMS function
                // We pass calledFromService: true to bypass user auth check in sendSMS
                const smsRes = await base44.asServiceRole.functions.invoke('sendSMS', {
                    to: data.phone,
                    body: messageBody,
                    companyId: data.company_id,
                    contactName: data.name,
                    calledFromService: true
                });
                
                results.sms = smsRes.status === 200 ? 'sent' : 'failed';
            } catch (e) {
                console.error('Error sending SMS:', e);
                results.sms = 'failed';
            }
        }

        return Response.json({ success: true, results });

    } catch (error) {
        console.error('Error sending new lead invite:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});