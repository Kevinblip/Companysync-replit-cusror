import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();
        
        const { event, data, old_data } = payload;
        
        // Only proceed if it's an update event and we have both old and new data
        if (event.type !== 'update' || !data || !old_data) {
            return Response.json({ message: "Not a status update or missing data" });
        }

        // Check if status changed
        if (data.status === old_data.status) {
            return Response.json({ message: "Status did not change" });
        }

        // Map entity name to object_type enum
        // entity_name comes as lowercase usually (e.g. "lead"), map to Capitalized if needed or match enum
        // The enum in schema has Capitalized values: Lead, Estimate, Project, Invoice, Customer
        const entityMap = {
            'Lead': 'Lead',
            'lead': 'Lead',
            'Estimate': 'Estimate',
            'estimate': 'Estimate',
            'Project': 'Project',
            'project': 'Project',
            'Invoice': 'Invoice',
            'invoice': 'Invoice',
            'Customer': 'Customer',
            'customer': 'Customer'
        };

        const objectType = entityMap[event.entity_name] || event.entity_name;

        // Create log entry
        // We use asServiceRole because automations run with service privileges and we want to ensure we can write to the log
        // regardless of the context, although standard client might work if the user has permissions.
        // However, automations often run in a context where we want to ensure execution.
        // But better to use standard base44 client if possible to respect RLS, but here we are logging.
        // Let's use base44.entities... but since we need to write to a log that might be read-only for some,
        // we'll use the standard client for now. If it fails due to permissions, we'd need service role.
        // Given this is a system function, let's use the authenticated client from the request (which is the automation actor).
        
        // Note: Automations trigger this function. The request is authenticated as the automation system?
        // Actually, for automations, usually we might need service role if the "actor" is the system.
        // But the prompt says "changed_by" is required.
        // data.updated_by contains the email of the user who modified the record.
        
        await base44.asServiceRole.entities.StageChangeLog.create({
            company_id: data.company_id,
            object_type: objectType,
            record_id: data.id,
            old_stage: old_data.status,
            new_stage: data.status,
            changed_by: data.updated_by || 'system',
            source: 'manual', // Defaulting to manual as requested, hard to distinguish API/Auto without more context
            created_by: data.updated_by // Set creator to the user who changed it
        });

        return Response.json({ success: true, message: "Stage change logged" });

    } catch (error) {
        console.error("Error logging stage change:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});