import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        console.log('🤖 Creating Thoughtly agent...');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { companyId } = await req.json();

        if (!companyId) {
            return Response.json({ error: 'Company ID required' }, { status: 400 });
        }

        // Get company details
        const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        const company = companies[0];

        if (!company) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        // Get company profile and training data
        const companyProfile = await base44.asServiceRole.entities.CompanyProfile.filter({ company_id: companyId });
        const trainingData = await base44.asServiceRole.entities.AITrainingData.filter({ 
            company_id: companyId,
            is_active: true 
        });

        // Build knowledge base from training data
        const knowledgeBase = trainingData
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .map(d => d.content)
            .join('\n\n');

        const profile = companyProfile[0];

        // Create agent instructions
        const instructions = `You are Lexi, the AI receptionist for ${company.company_name || 'our company'}.

COMPANY INFORMATION:
- Company: ${company.company_name}
- Industry: ${profile?.industry || 'service business'}
- Services: ${profile?.services_offered?.join(', ') || 'various services'}
${company.website ? `- Website: ${company.website}` : ''}
${company.phone ? `- Phone: ${company.phone}` : ''}

YOUR ROLE:
- Answer incoming calls professionally and warmly
- Help customers with questions about services, pricing, scheduling
- Collect customer information (name, phone, address, needs)
- Schedule appointments when requested
- Take messages for the team
- Transfer urgent calls to staff when needed

KNOWLEDGE BASE:
${knowledgeBase || 'No additional training data yet. Ask clarifying questions if unsure.'}

INSTRUCTIONS:
1. Always greet callers warmly with company name
2. Be helpful, professional, and conversational
3. Ask clarifying questions if you need more information
4. If caller asks for specific person, offer to take a message or transfer
5. For emergencies or urgent requests, immediately offer to transfer
6. Collect: name, phone, email, address, and reason for calling
7. Confirm information before ending call
8. Thank them for calling

TONE: ${profile?.ai_greeting_style || 'professional'} and natural

Remember: You represent ${company.company_name}. Be helpful and make customers feel valued!`;

        // Call Thoughtly API to create agent
        const thoughtlyApiKey = Deno.env.get('THOUGHTLY_API_KEY');
        
        if (!thoughtlyApiKey) {
            return Response.json({ 
                error: 'Thoughtly API key not configured. Please add it in Settings.' 
            }, { status: 400 });
        }

        const thoughtlyResponse = await fetch('https://api.thoughtly.ai/v1/agents', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${thoughtlyApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `Lexi of ${company.company_name}`,
                instructions: instructions,
                voice: {
                    provider: 'elevenlabs',
                    voice_id: 'rachel', // Natural female voice
                    stability: 0.5,
                    similarity_boost: 0.75
                },
                language: 'en-US',
                model: 'gpt-4',
                response_delay: 0.5,
                enable_transcription: true,
                enable_recording: true,
                max_call_duration: 600 // 10 minutes
            })
        });

        if (!thoughtlyResponse.ok) {
            const error = await thoughtlyResponse.text();
            console.error('Thoughtly API error:', error);
            return Response.json({ 
                error: 'Failed to create Thoughtly agent: ' + error 
            }, { status: 500 });
        }

        const agent = await thoughtlyResponse.json();

        console.log('✅ Thoughtly agent created:', agent.id);

        // Update Twilio settings with agent ID
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
        
        if (twilioSettings && twilioSettings.length > 0) {
            await base44.asServiceRole.entities.TwilioSettings.update(twilioSettings[0].id, {
                thoughtly_agent_id: agent.id,
                use_thoughtly_ai: true
            });
        }

        return Response.json({
            success: true,
            agent_id: agent.id,
            message: 'Thoughtly AI agent created successfully!'
        });

    } catch (error) {
        console.error('❌ Error creating Thoughtly agent:', error);
        return Response.json({ 
            error: error.message || 'Failed to create agent'
        }, { status: 500 });
    }
});