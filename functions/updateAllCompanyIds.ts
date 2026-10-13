import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { entityName, companyId } = body;

        if (!entityName || !companyId) {
            return Response.json({ 
                error: 'entityName and companyId required' 
            }, { status: 400 });
        }

        console.log(`🔧 Updating ALL ${entityName} to company_id: ${companyId}`);

        // Get ALL records for this entity (no filters!)
        // This uses the SDK but with service role to bypass user-level restrictions
        const allRecords = [];
        let skip = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            // Fetch batch without company_id filter
            const batch = await base44.asServiceRole.entities[entityName].list('-created_date', limit);
            
            if (batch.length === 0) {
                hasMore = false;
            } else {
                allRecords.push(...batch);
                skip += limit;
                
                if (batch.length < limit) {
                    hasMore = false;
                }
            }
        }

        console.log(`📦 Found ${allRecords.length} ${entityName} records total`);

        // Update all in parallel batches
        let updated = 0;
        const batchSize = 100;

        for (let i = 0; i < allRecords.length; i += batchSize) {
            const batch = allRecords.slice(i, i + batchSize);
            
            const promises = batch.map(record => 
                base44.asServiceRole.entities[entityName].update(record.id, { 
                    company_id: companyId 
                }).catch(err => {
                    console.error(`Failed to update ${record.id}:`, err.message);
                    return null;
                })
            );
            
            const results = await Promise.all(promises);
            updated += results.filter(r => r !== null).length;
        }

        console.log(`✅ Updated ${updated} ${entityName} records`);

        return Response.json({
            success: true,
            updated: updated,
            total_found: allRecords.length
        });

    } catch (error) {
        console.error('Update error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});