import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        console.log('🔍 Testing Thoughtly integration...');
        
        const base44 = createClientFromRequest(req);
        
        let user;
        try {
            user = await base44.auth.me();
        } catch (authError) {
            console.log('❌ Auth failed:', authError.message);
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Authentication failed: ' + authError.message 
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!user) {
            console.log('❌ No user');
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'User not authenticated' 
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('✅ User authenticated:', user.email);

        let body;
        try {
            body = await req.json();
        } catch (e) {
            console.log('❌ Failed to parse request body');
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Invalid request body' 
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { companyId } = body;
        console.log('📋 Company ID:', companyId);

        if (!companyId) {
            console.log('❌ Missing company ID');
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Company ID is required',
                step: 'Parse Request'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get Twilio settings
        console.log('🔎 Fetching Twilio settings...');
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ 
            company_id: companyId 
        });

        if (!twilioSettings || twilioSettings.length === 0) {
            console.log('❌ No Twilio settings found');
            return new Response(JSON.stringify({ 
                success: false,
                error: 'No Twilio settings found',
                step: 'Get Twilio Settings'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const config = twilioSettings[0];
        console.log('✅ Found Twilio settings');

        if (!config.use_thoughtly_ai) {
            console.log('❌ Thoughtly not enabled');
            return new Response(JSON.stringify({ 
                success: false,
                error: 'Thoughtly AI not enabled in Twilio settings',
                step: 'Check Thoughtly Enabled'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!config.thoughtly_agent_id) {
            console.log('❌ No agent ID');
            return new Response(JSON.stringify({ 
                success: false,
                error: 'No Thoughtly agent ID found',
                step: 'Check Agent ID'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('📞 Agent ID:', config.thoughtly_agent_id);

        // Test Thoughtly API access
        const thoughtlyApiKey = Deno.env.get('THOUGHTLY_API_KEY');
        const thoughtlyTeamId = Deno.env.get('THOUGHTLY_TEAM_ID');
        
        if (!thoughtlyApiKey || !thoughtlyTeamId) {
            console.log('❌ No API key');
            return new Response(JSON.stringify({ 
                success: false,
                error: 'Thoughtly credentials not configured',
                step: 'Check API Key',
                details: { hasApiKey: !!thoughtlyApiKey, hasTeamId: !!thoughtlyTeamId }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('🔑 API key found, fetching agent...');

        // Fetch agent details
        const agentResponse = await fetch(`https://api.thoughtly.com/interview/${config.thoughtly_agent_id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${thoughtlyApiKey}`,
                'x-api-token': thoughtlyApiKey,
                'x-team-id': thoughtlyTeamId,
                'Content-Type': 'application/json'
            }
        });

        if (!agentResponse.ok) {
            const errorText = await agentResponse.text().catch(() => 'Unknown error');
            console.log('❌ Thoughtly API error:', agentResponse.status, errorText);
            return new Response(JSON.stringify({ 
                success: false,
                error: `Thoughtly API error: ${agentResponse.status}`,
                step: 'Fetch Agent Details',
                status: agentResponse.status,
                details: errorText
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const agent = await agentResponse.json();
        console.log('✅ Agent fetched');

        const phoneNumber = agent.data?.phone_number || agent.phone_number;

        if (!phoneNumber) {
            console.log('❌ No phone number in response');
            return new Response(JSON.stringify({ 
                success: false,
                error: 'No phone number found in Thoughtly agent',
                step: 'Get Phone Number'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('📞 Phone number:', phoneNumber);

        // Check webhook URL and agent status
        const webhookUrl = agent.data?.webhook_url || agent.webhook_url;
        const isActive = agent.data?.active || agent.active;
        const agentStatus = agent.data?.status || agent.status;

        console.log('🔍 Agent details:', {
            active: isActive,
            status: agentStatus,
            webhook: webhookUrl
        });

        const issues = [];
        if (!isActive) {
            issues.push('⚠️ Agent is NOT ACTIVE in Thoughtly');
        }
        if (agentStatus !== 'published') {
            issues.push('⚠️ Agent is NOT PUBLISHED (status: ' + agentStatus + ')');
        }

        console.log('✅ All checks passed!');

        return new Response(JSON.stringify({
            success: true,
            message: issues.length > 0 ? 'Issues found!' : 'Thoughtly is configured correctly!',
            issues: issues,
            details: {
                agent_id: config.thoughtly_agent_id,
                phone_number: phoneNumber,
                webhook_url: webhookUrl,
                twilio_number: config.main_phone_number,
                agent_status: agentStatus,
                is_active: isActive,
                next_steps: issues.length > 0 ? [
                    '1. Go to Thoughtly dashboard: https://app.thoughtly.com',
                    '2. Find agent: ' + config.thoughtly_agent_id,
                    '3. Make sure it is PUBLISHED and ACTIVE',
                    '4. Then call: ' + phoneNumber
                ] : [
                    '1. Call this Thoughtly number directly: ' + phoneNumber,
                    '2. Should answer immediately with Sarah\'s voice',
                    '3. If using Twilio routing, set webhook to: /functions/thoughtlyIncomingCall'
                ]
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ Unexpected error:', error);
        return new Response(JSON.stringify({ 
            success: false,
            error: error.message || 'Unknown error occurred',
            step: 'Unexpected Error'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});