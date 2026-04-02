import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Fetch all companies to map ID to Name
        const companies = await base44.asServiceRole.entities.Company.list(undefined, 1000);
        const companyMap = {};
        companies.forEach(c => {
            companyMap[c.id] = c.company_name;
        });

        // Fetch all leads
        // Note: Fetching 10000 might be heavy, but we need the count
        const leads = await base44.asServiceRole.entities.Lead.list(undefined, 10000);
        
        const distribution = {};
        let orphanedCount = 0;

        leads.forEach(lead => {
            const companyId = lead.company_id;
            if (companyId) {
                const name = companyMap[companyId];
                let key;
                if (name) {
                    key = `${name} (${companyId})`;
                } else {
                    key = `Deleted Company (${companyId})`;
                }
                distribution[key] = (distribution[key] || 0) + 1;
            } else {
                orphanedCount++;
            }
        });

        // Sort by count desc
        const sortedDist = Object.entries(distribution)
            .sort(([,a], [,b]) => b - a)
            .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

        return Response.json({
            total_leads: leads.length,
            orphaned_leads: orphanedCount,
            distribution: sortedDist
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});