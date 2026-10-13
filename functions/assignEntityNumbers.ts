import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Allow service role usage if no user token (for initial setup/cron)
    // But prefer checking user if available.
    // For this specific backfill, we can run as service role.

    // Parse request to see which entity to number, or do all
    let targetEntity = "All";
    try {
        const body = await req.json();
        if (body.entity) targetEntity = body.entity;
    } catch (e) {
        // Body might be empty
    }

    const results = {};

    // Helper function to number an entity type
    const numberEntity = async (entityName, numberField) => {
        console.log(`Processing ${entityName}...`);
        const items = await base44.asServiceRole.entities[entityName].list('-created_date', 10000);
        items.reverse(); // Oldest first

        let updated = 0;
        
        // Group by company if company_id exists
        const itemsByCompany = {};
        const orphanItems = [];

        items.forEach(item => {
            if (item.company_id) {
                if (!itemsByCompany[item.company_id]) itemsByCompany[item.company_id] = [];
                itemsByCompany[item.company_id].push(item);
            } else {
                orphanItems.push(item);
            }
        });

        // Process per company
        for (const companyId in itemsByCompany) {
            const companyItems = itemsByCompany[companyId];
            for (let i = 0; i < companyItems.length; i++) {
                const item = companyItems[i];
                // Only update if missing number
                if (!item[numberField]) {
                    const num = i + 1;
                    await base44.asServiceRole.entities[entityName].update(item.id, {
                        [numberField]: num
                    });
                    updated++;
                }
            }
        }

        // Process orphans
        for (let i = 0; i < orphanItems.length; i++) {
             const item = orphanItems[i];
             if (!item[numberField]) {
                 await base44.asServiceRole.entities[entityName].update(item.id, {
                     [numberField]: i + 1
                 });
                 updated++;
             }
        }

        results[entityName] = { total: items.length, updated };
    };

    if (targetEntity === "Lead" || targetEntity === "All") {
        await numberEntity("Lead", "lead_number");
    }
    if (targetEntity === "Task" || targetEntity === "All") {
        await numberEntity("Task", "task_number");
    }
    if (targetEntity === "Project" || targetEntity === "All") {
        await numberEntity("Project", "project_number");
    }
    if (targetEntity === "Customer" || targetEntity === "All") {
        await numberEntity("Customer", "customer_number");
    }

    return Response.json({
        success: true,
        results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});