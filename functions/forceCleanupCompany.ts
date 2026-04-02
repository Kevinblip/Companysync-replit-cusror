import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This function forces deletion of a specific company and all its data
        // Target ID: 69627b6010ccc16d4abb28d7 (YICN Roofing Duplicate)
        const targetCompanyId = '69627b6010ccc16d4abb28d7';
        
        // Prioritize deleting Leads first as there are many (~972)
        // Then other entities, then Company
        const entitiesToDelete = [
            'Lead', 
            'Customer', 'Estimate', 'Invoice', 'Payment', 
            'Project', 'Task', 'CalendarEvent', 'Communication', 
            'StaffProfile', 'DroneInspection', 'Proposal', 'CompanySubscription'
        ];
        
        const results = {};
        const MAX_TIME_MS = 50000; // 50 seconds safety limit to avoid hard timeout
        const startTime = Date.now();
        
        for (const entityName of entitiesToDelete) {
            if (Date.now() - startTime > MAX_TIME_MS) {
                results[entityName] = "Skipped due to time limit";
                continue;
            }

            try {
                let deletedCount = 0;
                let hasMore = true;
                
                while (hasMore) {
                    // Check time limit
                    if (Date.now() - startTime > MAX_TIME_MS) {
                        results[entityName] = `Partial: ${deletedCount} (Time limit reached)`;
                        hasMore = false;
                        break;
                    }

                    // Fetch batch
                    const records = await base44.asServiceRole.entities[entityName].filter({ 
                        company_id: targetCompanyId 
                    }, undefined, 50); 
                    
                    if (!records || records.length === 0) {
                        hasMore = false;
                        break;
                    }

                    const ids = records.map(r => r.id);
                    
                    // Delete in very small chunks (2 at a time) with longer delays
                    const chunkSize = 2;
                    for (let i = 0; i < ids.length; i += chunkSize) {
                        const chunk = ids.slice(i, i + chunkSize);
                        await Promise.all(chunk.map(id => 
                            base44.asServiceRole.entities[entityName].delete(id).catch(e => console.error(e))
                        ));
                        // Longer delay between chunks to reset rate limit bucket
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    deletedCount += ids.length;
                }
                
                if (!results[entityName]) { // Don't overwrite partial message
                    results[entityName] = deletedCount;
                }
            } catch (err) {
                results[entityName] = `Error: ${err.message}`;
            }
        }
        
        // 2. Delete the Company record itself
        try {
            await base44.asServiceRole.entities.Company.delete(targetCompanyId);
            results['Company'] = 'Deleted';
        } catch (err) {
             results['Company'] = `Error: ${err.message}`;
        }

        return Response.json({ 
            success: true, 
            message: "Cleanup completed",
            details: results 
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});