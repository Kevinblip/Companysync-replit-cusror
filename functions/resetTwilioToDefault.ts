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

        console.log(`🔄 Resetting Twilio configuration for company ${company_id}...`);

        // 1. Update TwilioSettings to disable Thoughtly
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id });
        
        if (twilioSettings.length > 0) {
            await base44.asServiceRole.entities.TwilioSettings.update(twilioSettings[0].id, {
                use_thoughtly_ai: false,
                thoughtly_agent_id: null
            });
            console.log('✅ Disabled Thoughtly in database settings');
        } else {
            console.log('⚠️ No TwilioSettings found to update');
        }

        // 2. Restore original webhooks (pointing to incomingCall/incomingSMS)
        // We call autoConfigureTwilioWebhook which handles the Twilio API interaction
        // Since we updated the DB above (or if it exists), autoConfigure will pick up the creds from DB
        // and set the URLs to the default Base44 functions.
        
        try {
            const resetResponse = await base44.asServiceRole.functions.invoke('autoConfigureTwilioWebhook', {});
            
            // Check if it was successful
            if (resetResponse.data?.error) {
                throw new Error(resetResponse.data.error);
            }

            return Response.json({
                success: true,
                message: 'Twilio settings reset to default (Lexi/Sarah internal)',
                details: resetResponse.data
            });

        } catch (webhookError) {
            console.error('❌ Failed to reset webhooks:', webhookError);
            return Response.json({ 
                success: false, 
                error: 'Database updated but webhook reset failed: ' + webhookError.message 
            });
        }

    } catch (error) {
        console.error('❌ Error in resetTwilioToDefault:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});