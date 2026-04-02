import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { company_id } = await req.json();

        if (!company_id) {
            return Response.json({ error: 'company_id required' }, { status: 400 });
        }

        // Get Twilio settings to find the phone number and agent ID
        const twilioSettings = await base44.entities.TwilioSettings.filter({ company_id });
        const twilio = twilioSettings[0];

        // Allow testing even without full DB setup if agent_id is passed
        const agentId = twilio?.thoughtly_agent_id || (await req.json()).agent_id;

        if (!agentId) {
            return Response.json({ 
                error: 'No Thoughtly Agent ID found',
                help: 'Please connect Thoughtly first or provide agent_id'
            }, { status: 400 });
        }

        const phoneNumber = twilio?.thoughtly_phone || twilio?.main_phone_number || '+15550000000';
        if (!phoneNumber) {
            return Response.json({ 
                error: 'No phone number configured',
                help: 'Please set a phone number in Twilio Settings'
            }, { status: 400 });
        }

        // Send a test webhook payload to simulate a call
        const testPayload = {
            type: 'NEW_RESPONSE',
            data: {
                agent_id: twilio.thoughtly_agent_id,
                from: '+15551234567',
                to: phoneNumber,
                customer_name: 'Test Caller',
                customer: {
                    name: 'Test Caller',
                    phone: '+15551234567'
                },
                transcript: 'This is a test call from the diagnostic tool.',
                conversation: 'Customer: Hello, I need a roof inspection.\nAlex: I\'d be happy to help! Let me send you our calendar link.',
                intent: 'test_diagnostic',
                summary: {
                    intent: 'test_diagnostic'
                },
                duration: 120,
                recording_url: null
            }
        };

        const webhookUrl = `${Deno.env.get('APP_URL') || 'https://getcompanysync.com'}/api/functions/thoughtlyWebhook`;
        
        console.log('🧪 Sending test webhook to:', webhookUrl);
        console.log('📦 Test payload:', JSON.stringify(testPayload, null, 2));

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testPayload)
        });

        const responseText = await response.text();
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = responseText;
        }

        console.log('📥 Webhook response:', responseData);

        if (!response.ok) {
            return Response.json({
                success: false,
                error: 'Webhook test failed',
                status: response.status,
                response: responseData
            }, { status: 500 });
        }

        return Response.json({
            success: true,
            message: 'Test webhook sent successfully! Check the Communication tab and Active Conversations.',
            webhook_url: webhookUrl,
            test_payload: testPayload,
            webhook_response: responseData
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});