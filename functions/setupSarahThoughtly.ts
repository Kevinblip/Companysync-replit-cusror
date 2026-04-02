import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { companyId } = await req.json();
        
        // ... (skipping unchanged parts for brevity if I could, but I must write full file) ...
        // I will write the FULL file.
        
        if (!companyId) {
            return Response.json({ error: 'Company ID required' }, { status: 400 });
        }

        // Get company and Sarah settings
        const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        const company = companies[0];

        if (!company) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        // Get Sarah's settings
        const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({ 
            company_id: companyId, 
            assistant_name: 'sarah' 
        });
        const settings = settingsRows[0] || {};

        const companyName = settings.brand_short_name || company.company_name || 'our company';
        
        // Detailed System Prompt for CompanySync SDR
        const systemPrompt = settings.system_prompt || `You are Sarah, the AI Sales Representative for CompanySync, the #1 All-in-One CRM built specifically for roofing and exterior contractors.
Your goal is to help contractors streamline their business by answering questions and scheduling personalized product demos.

Key Selling Points to Highlight:
- **All-in-One:** We replace 5+ tools (CRM, Estimating, Invoicing, Storm Tracking, Automations).
- **AI-Powered:** We have built-in AI for answering calls, analyzing drone photos, and automated follow-ups.
- **Storm Tracking:** Integrated hail and wind maps to find leads fast.
- **Mobile Friendly:** Full functionality for field reps on the go.

Conversation Guidelines:
- **Be enthusiastic but professional.** You are talking to business owners who are busy.
- **Qualify the lead:** Ask if they are currently using a CRM or doing things manually (pen & paper/spreadsheets).
- **Goal:** Drive them to a demo. "The best way to see how we can save you 10+ hours a week is to see it in action. Can I book a quick 15-minute demo for you?"
- **Pricing:** "We have plans for every stage of business, from solo contractors to large enterprises. We can discuss the perfect fit during your demo."

Scheduling:
- Use this link to book demos: https://calendly.com/companysync/demo
- If they are an existing customer needing support, direct them to support@companysync.com.`;

        // Update the prompt in DB first, so even if API fails, the prompt is saved
        if (settingsRows[0]) {
             await base44.asServiceRole.entities.AssistantSettings.update(settingsRows[0].id, {
                system_prompt: systemPrompt,
                voice_id: 'Nichola Schwartz' // Save desired voice name
             });
        }

        const thoughtlyApiKey = (Deno.env.get('THOUGHTLY_API_KEY') || '').trim();
        const thoughtlyTeamId = (Deno.env.get('THOUGHTLY_TEAM_ID') || '').trim();
        
        if (!thoughtlyApiKey || !thoughtlyTeamId) {
            return Response.json({ 
                error: 'Thoughtly API key or Team ID not configured.' 
            }, { status: 400 });
        }

        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
        
        console.log('🚀 Creating Thoughtly agent (Attempting /interviews endpoint)...');
        console.log('   Company:', companyName);
        console.log('   API Key Len:', thoughtlyApiKey.length);
        console.log('   Team ID:', thoughtlyTeamId);
        
        // Try POST /interviews (plural)
        const thoughtlyResponse = await fetch('https://api.thoughtly.com/interviews', {
            method: 'POST',
            headers: {
                'x-api-token': thoughtlyApiKey,
                'team_id': thoughtlyTeamId,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: `Sarah, AI CompanySync (Virtual Receptionist)`,
                prompt: systemPrompt,
                voice: 'Nichola Schwartz', 
                language: 'en-US',
                temperature: 0.9,
                webhook_url: `${Deno.env.get('APP_URL')}/api/functions/thoughtlyWebhook`
            })
        });
        
        if (!thoughtlyResponse.ok) {
            const error = await thoughtlyResponse.text();
            console.error('❌ Thoughtly API error:', thoughtlyResponse.status, error);
            
            return Response.json({ 
                error: `Thoughtly API error (${thoughtlyResponse.status}): ${error}. settings updated locally.`,
                status: thoughtlyResponse.status
            }, { status: 500 });
        }

        const agent = await thoughtlyResponse.json();
        console.log('✅ Thoughtly agent created:', JSON.stringify(agent, null, 2));

        // Update Sarah settings with agent ID
        if (settingsRows[0]) {
            await base44.asServiceRole.entities.AssistantSettings.update(settingsRows[0].id, {
                thoughtly_agent_id: agent.id || agent.agent_id,
                thoughtly_phone: agent.phone_number
            });
        }

        // Update Twilio settings
        if (twilioSettings && twilioSettings.length > 0) {
            await base44.asServiceRole.entities.TwilioSettings.update(twilioSettings[0].id, {
                use_thoughtly_ai: true,
                thoughtly_agent_id: agent.id || agent.agent_id
            });
        }

        return Response.json({
            success: true,
            agent_id: agent.id || agent.agent_id,
            message: 'Sarah is now powered by Thoughtly! Update your Twilio webhook to forward calls.'
        });

    } catch (error) {
        console.error('❌ Error setting up Sarah with Thoughtly:', error);
        return Response.json({ 
            error: error.message || 'Failed to create agent'
        }, { status: 500 });
    }
});