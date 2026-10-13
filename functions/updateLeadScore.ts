import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const { leadId, action, points, actionDescription } = await req.json();

        if (!leadId || !action || points === undefined) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Get or create lead score
        const existingScores = await base44.asServiceRole.entities.LeadScore.filter({ 
            lead_id: leadId 
        });

        let leadScore;
        const lead = (await base44.asServiceRole.entities.Lead.filter({ id: leadId }))[0];
        
        if (!lead) {
            return Response.json({ error: 'Lead not found' }, { status: 404 });
        }

        const scoreEntry = {
            action: actionDescription || action,
            points: points,
            timestamp: new Date().toISOString()
        };

        if (existingScores.length > 0) {
            leadScore = existingScores[0];
            const newTotal = (leadScore.total_score || 0) + points;
            const newHistory = [...(leadScore.score_history || []), scoreEntry];

            // Determine temperature
            let temperature = 'cold';
            if (newTotal >= 80) temperature = 'hot';
            else if (newTotal >= 40) temperature = 'warm';

            await base44.asServiceRole.entities.LeadScore.update(leadScore.id, {
                total_score: Math.max(0, newTotal), // Don't go below 0
                temperature: temperature,
                score_history: newHistory,
                last_activity: new Date().toISOString()
            });

            leadScore = { ...leadScore, total_score: newTotal, temperature };
        } else {
            // Create new score
            let temperature = 'cold';
            if (points >= 80) temperature = 'hot';
            else if (points >= 40) temperature = 'warm';

            leadScore = await base44.asServiceRole.entities.LeadScore.create({
                lead_id: leadId,
                lead_name: lead.name,
                total_score: Math.max(0, points),
                temperature: temperature,
                score_history: [scoreEntry],
                last_activity: new Date().toISOString()
            });
        }

        return Response.json({
            success: true,
            leadScore: leadScore
        });

    } catch (error) {
        console.error('Lead Score Update Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});