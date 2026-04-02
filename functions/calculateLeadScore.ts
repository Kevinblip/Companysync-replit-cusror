import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

/**
 * Calculates lead score based on various factors:
 * - AI conversation data (intent, sentiment)
 * - Communication frequency
 * - Engagement (opened emails, viewed estimates)
 * - Lead source
 * - Time decay
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const { leadId } = await req.json();

        if (!leadId) {
            return Response.json({ error: 'Missing leadId' }, { status: 400 });
        }

        // Get lead
        const leads = await base44.asServiceRole.entities.Lead.filter({ id: leadId });
        if (leads.length === 0) {
            return Response.json({ error: 'Lead not found' }, { status: 404 });
        }
        const lead = leads[0];

        // Get all communications for this lead
        const communications = await base44.asServiceRole.entities.Communication.filter({
            contact_email: lead.email
        });

        let totalScore = 0;
        const scoreBreakdown = {};

        // 1. Base score for lead creation
        totalScore += 10;
        scoreBreakdown.created = 10;

        // 2. Source quality (referral = best, cold call = lowest)
        const sourceScores = {
            'referral': 20,
            'website': 15,
            'storm_tracker': 15,
            'property_importer': 10,
            'social_media': 10,
            'advertisement': 10,
            'cold_call': 5,
            'manual': 5,
            'other': 5
        };
        const sourceScore = sourceScores[lead.source] || 5;
        totalScore += sourceScore;
        scoreBreakdown.source = sourceScore;

        // 3. AI Conversation Analysis
        let aiScore = 0;
        communications.forEach(comm => {
            // Intent scoring
            if (comm.intent === 'get_quote' || comm.intent === 'pricing') aiScore += 30;
            else if (comm.intent === 'schedule' || comm.intent === 'consultation') aiScore += 20;
            else if (comm.intent === 'information') aiScore += 10;
            else if (comm.intent === 'emergency' || comm.intent === 'urgent') aiScore += 40;

            // Sentiment scoring
            if (comm.sentiment === 'positive') aiScore += 15;
            else if (comm.sentiment === 'neutral') aiScore += 5;
            else if (comm.sentiment === 'negative') aiScore -= 10;

            // Confidence bonus (high confidence AI = more reliable)
            if (comm.confidence && comm.confidence > 0.8) aiScore += 5;
        });
        totalScore += aiScore;
        scoreBreakdown.ai_analysis = aiScore;

        // 4. Communication frequency & engagement
        let engagementScore = 0;
        const callCount = communications.filter(c => c.communication_type === 'call').length;
        const smsCount = communications.filter(c => c.communication_type === 'sms').length;
        const emailCount = communications.filter(c => c.communication_type === 'email').length;

        engagementScore += callCount * 10; // Each call = 10 points
        engagementScore += smsCount * 5;   // Each SMS = 5 points
        engagementScore += emailCount * 3; // Each email = 3 points

        // Inbound communications are more valuable
        const inboundCount = communications.filter(c => c.direction === 'inbound').length;
        engagementScore += inboundCount * 10;

        totalScore += engagementScore;
        scoreBreakdown.engagement = engagementScore;

        // 5. Lead status
        const statusScores = {
            'new': 5,
            'contacted': 10,
            'qualified': 20,
            'proposal': 30,
            'negotiation': 40,
            'won': 100,
            'lost': -50
        };
        const statusScore = statusScores[lead.status] || 5;
        totalScore += statusScore;
        scoreBreakdown.status = statusScore;

        // 6. Time decay (if last contact was long ago)
        if (lead.last_contact_date) {
            const daysSinceContact = Math.floor((new Date() - new Date(lead.last_contact_date)) / (1000 * 60 * 60 * 24));
            if (daysSinceContact > 0) {
                const decayPenalty = Math.min(daysSinceContact * 5, 50); // Max -50 points
                totalScore -= decayPenalty;
                scoreBreakdown.time_decay = -decayPenalty;
            }
        }

        // 7. Lead value (estimated deal size)
        if (lead.value && lead.value > 0) {
            const valueScore = Math.min(Math.floor(lead.value / 1000) * 2, 30); // $1k = 2 points, max 30
            totalScore += valueScore;
            scoreBreakdown.deal_value = valueScore;
        }

        // Determine temperature
        let temperature = 'cold';
        if (totalScore >= 80) temperature = 'hot';
        else if (totalScore >= 40) temperature = 'warm';

        // Update or create lead score
        const existingScores = await base44.asServiceRole.entities.LeadScore.filter({ lead_id: leadId });
        
        if (existingScores.length > 0) {
            await base44.asServiceRole.entities.LeadScore.update(existingScores[0].id, {
                total_score: Math.max(0, totalScore),
                temperature: temperature,
                last_activity: new Date().toISOString()
            });
        } else {
            await base44.asServiceRole.entities.LeadScore.create({
                lead_id: leadId,
                lead_name: lead.name,
                total_score: Math.max(0, totalScore),
                temperature: temperature,
                score_history: [{
                    action: 'Initial score calculation',
                    points: totalScore,
                    timestamp: new Date().toISOString()
                }],
                last_activity: new Date().toISOString()
            });
        }

        return Response.json({
            success: true,
            leadId: leadId,
            totalScore: Math.max(0, totalScore),
            temperature: temperature,
            breakdown: scoreBreakdown
        });

    } catch (error) {
        console.error('Calculate Lead Score Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});