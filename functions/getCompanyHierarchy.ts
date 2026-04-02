import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { company_id } = await req.json();

        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!company_id) {
            return Response.json({ error: 'Missing company_id' }, { status: 400 });
        }

        // 1. Get the requested company
        const company = await base44.entities.Company.get(company_id);
        if (!company) {
             return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        // 2. Check permissions (basic check: user must be associated with the company somehow)
        // In a real scenario, check if user is admin of this company or parent
        // For now, assuming if they can call this with a valid ID they have some access context from frontend

        let hierarchy = {
            parent: null,
            current: company,
            children: []
        };

        // 3. If it has a parent, fetch it
        if (company.parent_company_id) {
            const parent = await base44.entities.Company.get(company.parent_company_id);
            hierarchy.parent = parent;
            
            // Also fetch siblings? Maybe later
        }

        // 4. Fetch children (where parent_company_id == company_id)
        const children = await base44.entities.Company.filter({ parent_company_id: company_id });
        hierarchy.children = children;

        return Response.json(hierarchy);

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});