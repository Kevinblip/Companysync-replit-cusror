import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { agent_id, company_id, phone_number } = await req.json();

        if (!agent_id) {
            return Response.json({ error: 'agent_id required' }, { status: 400 });
        }

        if (!company_id) {
            return Response.json({ error: 'company_id required' }, { status: 400 });
        }

        const apiKey = (Deno.env.get('THOUGHTLY_API_KEY') || '').trim();
        const teamId = (Deno.env.get('THOUGHTLY_TEAM_ID') || '').trim();
        if (!apiKey || !teamId) {
            return Response.json({ 
                error: 'Thoughtly credentials not configured. Please set THOUGHTLY_API_KEY and THOUGHTLY_TEAM_ID secrets.',
                details: { hasApiKey: !!apiKey, hasTeamId: !!teamId }
            }, { status: 500 });
        }

        let appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);
        const webhookUrl = `${appUrl}/api/functions/thoughtlyWebhook`;

        // Update Thoughtly agent with webhook URL
        console.log(`🔧 Configuring webhook for agent ${agent_id}: ${webhookUrl}`);
        console.log(`🔑 Using API key: ${apiKey.substring(0, 10)}...`);
        
        const subscribe = async (type) => {
            const r = await fetch('https://api.thoughtly.com/webhooks/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-token': apiKey,
                    'team_id': teamId
                },
                body: JSON.stringify({ type, url: webhookUrl, data: agent_id })
            });
            const txt = await r.text();
            return { ok: r.ok, status: r.status, body: txt }; 
        };

        const [resNew, resTransfer] = await Promise.all([
            subscribe('NEW_RESPONSE'),
            subscribe('PHONE_TRANSFER')
        ]);

        console.log('📊 Subscribe NEW_RESPONSE:', resNew.status, resNew.body);
        console.log('📊 Subscribe PHONE_TRANSFER:', resTransfer.status, resTransfer.body);

        // Treat "already exists" (400/409) as success
        const alreadyExists = (res) => {
            if (!res) return false;
            const txt = String(res.body || '').toLowerCase();
            return (res.status === 400 || res.status === 409) && txt.includes('already exists');
        };

        const newOk = resNew.ok || alreadyExists(resNew);
        const transferOk = resTransfer.ok || alreadyExists(resTransfer);

        if (!newOk && !transferOk) {
            return Response.json({
                error: 'Thoughtly webhook subscription failed',
                details: { NEW_RESPONSE: resNew, PHONE_TRANSFER: resTransfer }
            }, { status: 500 });
        }

        // Save agent_id and phone to TwilioSettings
        console.log('💾 Saving agent_id and phone to database...');
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id });
        
        if (twilioSettings.length > 0) {
            await base44.asServiceRole.entities.TwilioSettings.update(twilioSettings[0].id, {
                thoughtly_agent_id: agent_id,
                thoughtly_phone: phone_number || twilioSettings[0].thoughtly_phone || twilioSettings[0].main_phone_number,
                use_thoughtly_ai: true
            });
            console.log('✅ Updated existing TwilioSettings record');
        } else {
            await base44.asServiceRole.entities.TwilioSettings.create({
                company_id,
                thoughtly_agent_id: agent_id,
                thoughtly_phone: phone_number,
                use_thoughtly_ai: true
            });
            console.log('✅ Created new TwilioSettings record');
        }

        // Also sync to AssistantSettings for consistency
        try {
            const assistantSettings = await base44.asServiceRole.entities.AssistantSettings.filter({ 
                company_id, 
                assistant_name: 'sarah' 
            });
            
            if (assistantSettings.length > 0) {
                await base44.asServiceRole.entities.AssistantSettings.update(assistantSettings[0].id, {
                    thoughtly_agent_id: agent_id,
                    thoughtly_phone: phone_number || assistantSettings[0].thoughtly_phone
                });
                console.log('✅ Synced to AssistantSettings');
            }
        } catch (e) {
            console.warn('⚠️ Failed to sync to AssistantSettings:', e.message);
            // Non-critical, continue
        }

        return Response.json({
            success: true,
            message: 'Thoughtly connected! Agent ID saved. Incoming calls will now appear in the CRM.',
            webhook_url: webhookUrl,
            agent_id: agent_id,
            phone_number: phone_number,
            subscriptions: { NEW_RESPONSE: resNew, PHONE_TRANSFER: resTransfer }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});