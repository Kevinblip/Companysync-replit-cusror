import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { companyId, agentId } = await req.json();

        if (!companyId || !agentId) {
            return Response.json({ error: 'Company ID and Agent ID required' }, { status: 400 });
        }

        const thoughtlyApiKey = Deno.env.get('THOUGHTLY_API_KEY');
        
        if (!thoughtlyApiKey) {
            return Response.json({ 
                error: 'Thoughtly API key not configured' 
            }, { status: 400 });
        }

        // Fetch agent details from Thoughtly
        const agentResponse = await fetch(`https://api.thoughtly.com/interview/${agentId}`, {
            method: 'GET',
            headers: {
                'x-api-token': thoughtlyApiKey,
                'team_id': Deno.env.get('THOUGHTLY_TEAM_ID') || '',
                'Content-Type': 'application/json'
            }
        });

        if (!agentResponse.ok) {
            return Response.json({ 
                error: `Failed to fetch Thoughtly agent: ${agentResponse.status}` 
            }, { status: 500 });
        }

        const agent = await agentResponse.json();
        console.log('📋 Raw agent response:', JSON.stringify(agent, null, 2));

        const phoneNumber = agent.data?.phone_number || agent.phone_number;

        if (!phoneNumber) {
            return Response.json({ 
                error: 'No phone number found in Thoughtly agent. Agent may not be fully provisioned yet.' 
            }, { status: 400 });
        }

        // Configure webhook URL in Thoughtly agent
        const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        const webhookUrl = `${appUrl}/api/functions/thoughtlyWebhook`;

        console.log('🔗 Setting webhook URL:', webhookUrl);

        const updateResponse = await fetch(`https://api.thoughtly.com/interview/${agentId}`, {
            method: 'PATCH',
            headers: {
                'x-api-token': thoughtlyApiKey,
                'team_id': Deno.env.get('THOUGHTLY_TEAM_ID') || '',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                webhook_url: webhookUrl,
                active: true
            })
        });

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error('❌ Failed to set webhook URL:', updateResponse.status, errorText);
        } else {
            console.log('✅ Webhook URL set successfully');
        }

        // Update or create Sarah settings
        const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({ 
            company_id: companyId, 
            assistant_name: 'sarah' 
        });

        if (settingsRows[0]) {
            await base44.asServiceRole.entities.AssistantSettings.update(settingsRows[0].id, {
                thoughtly_agent_id: agentId,
                thoughtly_phone: phoneNumber
            });
        } else {
            await base44.asServiceRole.entities.AssistantSettings.create({
                company_id: companyId,
                assistant_name: 'sarah',
                thoughtly_agent_id: agentId,
                thoughtly_phone: phoneNumber
            });
        }

        // Update Twilio settings
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ 
            company_id: companyId 
        });

        if (twilioSettings && twilioSettings.length > 0) {
            await base44.asServiceRole.entities.TwilioSettings.update(twilioSettings[0].id, {
                use_thoughtly_ai: true,
                thoughtly_agent_id: agentId,
                main_phone_number: twilioSettings[0].main_phone_number || phoneNumber
            });
        }

        return Response.json({
            success: true,
            phone_number: phoneNumber,
            webhook_url: webhookUrl,
            agent_status: agent.data?.active || agent.active ? 'active' : 'inactive',
            message: 'Thoughtly agent linked successfully!',
            instructions: [
                `1. Call ${phoneNumber} directly`,
                '2. If call hangs up, check Thoughtly dashboard for agent status',
                '3. Agent must be ACTIVE and PUBLISHED in Thoughtly',
                '4. Webhook should be: ' + webhookUrl
            ]
        });

    } catch (error) {
        console.error('❌ Error linking Thoughtly agent:', error);
        return Response.json({ 
            error: error.message || 'Failed to link agent'
        }, { status: 500 });
    }
});