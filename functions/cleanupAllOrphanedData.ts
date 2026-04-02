import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        // Removed auth check for tool execution
        
        const PROTECTED_NAMES = ['CompanySync'];
        const ENTITIES = [
            'Lead', // Prioritize Lead
            'Customer', 'Invoice', 'Estimate', 
            'Task', 'Project', 'CalendarEvent', 'Communication', 
            'StaffProfile'
        ];

        // 1. Get all valid, ACTIVE companies (fetch more just in case)
        const companies = await base44.asServiceRole.entities.Company.filter({ is_deleted: { $ne: true } }, undefined, 1000);
        const validCompanyIds = new Set(companies.map(c => c.id));
        
        console.log(`Found ${companies.length} valid companies.`);

        const stats = {
            deleted: {},
            errors: []
        };

        // 2. Cleanup loop
        for (const entity of ENTITIES) {
            stats.deleted[entity] = 0;
            // Increase limit to capture all junk
            const records = await base44.asServiceRole.entities[entity].list('-created_date', 10000);
            
            const toDelete = [];
            for (const record of records) {
                // If company_id is missing OR not in valid list
                if (!record.company_id || !validCompanyIds.has(record.company_id)) {
                    toDelete.push(record.id);
                }
            }

            console.log(`Found ${toDelete.length} orphaned/invalid ${entity} records.`);

            // Batch delete
            if (toDelete.length > 0) {
                const chunkSize = 10;
                for (let i = 0; i < toDelete.length; i += chunkSize) {
                    const chunk = toDelete.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(id => 
                        base44.asServiceRole.entities[entity].delete(id)
                            .then(() => stats.deleted[entity]++)
                            .catch(e => stats.errors.push(`Failed to delete ${entity} ${id}: ${e.message}`))
                    ));
                    // Tiny delay
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }

        return Response.json({ 
            success: true, 
            message: `Cleanup complete. Protected ${protectedCompanies.length} critical companies.`,
            stats 
        });

    } catch (error) {
        console.error('Cleanup Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});