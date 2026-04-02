import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
        if (!apiKey) {
            return Response.json({ error: 'GOOGLE_GEMINI_API_KEY is missing' }, { status: 500 });
        }

        // Test listing models
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);
        
        if (!response.ok) {
            const text = await response.text();
            return Response.json({ 
                success: false, 
                status: response.status, 
                error: text,
                key_preview: apiKey.substring(0, 5) + '...' 
            });
        }

        const data = await response.json();
        const models = data.models || [];
        
        // Filter for Gemini models
        const geminiModels = models.filter(m => m.name.includes('gemini'));

        return Response.json({
            success: true,
            model_count: geminiModels.length,
            models: geminiModels.map(m => m.name),
            key_preview: apiKey.substring(0, 5) + '...'
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});