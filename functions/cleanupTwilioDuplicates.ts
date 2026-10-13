import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // The IDs of the duplicate/incorrect TwilioSettings records to delete
        // These belong to other companies but share the main CompanySync number
        const idsToDelete = [
            '696d61307306546292718d35', // Stone Enterprise
            '696bc491a4d52528c434b20f', // YICN (Legacy)
            '696bc37a1aa4218ff9a61e68', // YICN
            '696a321d012a769e2b2c12f7', // YICN (Legacy)
            '6967ef920bcb8cbfc8d4344d'  // Wolfe Enterprise
        ];

        const results = [];
        
        for (const id of idsToDelete) {
            try {
                // Use service role to bypass company isolation rules
                await base44.asServiceRole.entities.TwilioSettings.delete(id);
                results.push({ id, status: 'deleted' });
            } catch (e) {
                results.push({ id, status: 'failed', error: e.message });
            }
        }

        return Response.json({ 
            message: "Cleanup completed", 
            results 
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});