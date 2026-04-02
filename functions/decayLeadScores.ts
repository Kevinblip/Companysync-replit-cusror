import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// This function should be called daily via a cron job
// Decays lead scores by 10 points per day of inactivity

Deno.serve(async (req) => {
    try {
        // 🔐 Validate CRON_SECRET_TOKEN
        const authToken = Deno.env.get('CRON_SECRET_TOKEN');
        let processedReq = req;
        
        if (authToken) {
            const requestToken = req.headers.get('Authorization')?.replace('Bearer ', '');
            if (requestToken !== authToken) {
                return Response.json({ error: 'Unauthorized - Invalid token' }, { status: 401 });
            }
            const headers = new Headers(req.headers);
            headers.delete('Authorization');
            processedReq = new Request(req.url, { headers, body: req.body, method: req.method });
        }
        
        const base44 = createClientFromRequest(processedReq);

        // Get all lead scores
        const leadScores = await base44.asServiceRole.entities.LeadScore.list();

        const now = new Date();
        let updatedCount = 0;

        for (const score of leadScores) {
            if (!score.last_activity) continue;

            const lastActivity = new Date(score.last_activity);
            const daysSinceActivity = Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24));

            // Decay 10 points per day after 1 day of inactivity
            if (daysSinceActivity > 0) {
                const decayPoints = daysSinceActivity * 10;
                const newScore = Math.max(0, (score.total_score || 0) - decayPoints);

                // Update temperature
                let temperature = 'cold';
                if (newScore >= 80) temperature = 'hot';
                else if (newScore >= 40) temperature = 'warm';

                const scoreEntry = {
                    action: `Inactivity decay (${daysSinceActivity} days)`,
                    points: -decayPoints,
                    timestamp: new Date().toISOString()
                };

                await base44.asServiceRole.entities.LeadScore.update(score.id, {
                    total_score: newScore,
                    temperature: temperature,
                    score_history: [...(score.score_history || []), scoreEntry]
                });

                updatedCount++;
            }
        }

        return Response.json({
            success: true,
            message: `Decayed ${updatedCount} lead scores`
        });

    } catch (error) {
        console.error('Decay Lead Scores Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});