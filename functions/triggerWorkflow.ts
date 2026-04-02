import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function can be called with or without authentication
    // For webhook/system triggers, we use service role
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (e) {
      console.log('No user auth, using service role');
    }

    const { 
      triggerType, 
      companyId, 
      entityType, 
      entityId, 
      entityData 
    } = await req.json();

    if (!triggerType || !companyId) {
      return Response.json({ 
        error: 'triggerType and companyId are required' 
      }, { status: 400 });
    }

    console.log('🔔 Triggering workflows for:', triggerType, 'Company:', companyId);

    // Find matching workflows
    const workflows = await base44.asServiceRole.entities.Workflow.filter({
      company_id: companyId,
      trigger_type: triggerType,
      is_active: true
    });

    if (!workflows || workflows.length === 0) {
      console.log('⚠️ No workflows found for trigger:', triggerType);
      return Response.json({ 
        success: true, 
        message: 'No workflows to trigger',
        workflows_found: 0 
      });
    }

    console.log(`✅ Found ${workflows.length} workflows to execute`);

    // Execute each workflow
    for (const workflow of workflows) {
      try {
        // ✅ VALIDATE: Don't create workflows without valid entity data
        if (!entityType || !entityId || entityType === 'Unknown' || entityId === 'unknown') {
          console.warn(`⚠️ Skipping workflow "${workflow.workflow_name}" - missing valid entity data:`, {
            entityType,
            entityId,
            entityData
          });
          continue;
        }

        await base44.asServiceRole.functions.invoke('executeWorkflow', {
          workflow_id: workflow.id,
          entity_data: {
            ...entityData,
            entity_type: entityType,
            entity_id: entityId,
            entity_name: entityData?.name || entityData?.customer_name || entityData?.lead_name || entityData?.task_name || 'Unknown'
          },
          company_id: companyId
        });
        console.log(`✅ Triggered workflow: ${workflow.workflow_name}`);
      } catch (error) {
        console.error(`❌ Failed to trigger workflow ${workflow.workflow_name}:`, error.message);
      }
    }

    return Response.json({
      success: true,
      message: `Triggered ${workflows.length} workflows`,
      workflows_triggered: workflows.length
    });

  } catch (error) {
    console.error('Trigger workflow error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});