import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// This webhook gets called automatically by Base44 when any entity is created/updated
// Configure it in Settings → Integrations → Entity Webhooks

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const body = await req.json();
    console.log('📥 Entity webhook received:', body);

    // Normalize payload to handle both Webhook and Entity Automation formats
    let eventType = body.event_type;
    let entityName = body.entity_name;
    let entityId = body.entity_id;
    let entityData = body.entity_data || body.data || {};
    let oldData = body.old_data;
    let companyId = body.company_id || entityData.company_id;

    // Handle standard Entity Automation payload structure
    if (body.event) {
      eventType = body.event.type; // 'create', 'update', 'delete'
      entityName = body.event.entity_name;
      entityId = body.event.entity_id;
    }

    // Normalize event type names (Base44 uses 'create', function used 'created')
    if (eventType === 'create') eventType = 'created';
    if (eventType === 'update') eventType = 'updated';
    if (eventType === 'delete') eventType = 'deleted';

    if (!companyId) {
      console.log('⚠️ No company_id found in payload or entity data, skipping workflow');
      // Some system events might not have company_id, don't error out
      return Response.json({ success: true, message: 'No company_id found' });
    }

    let triggerType = null;
    // Map old_data to local variable for consistency if needed
    const old_data = oldData;
    const entity_data = entityData;
    const entity_name = entityName;
    const event_type = eventType;
    const entity_id = entityId;

    // Map entity events to workflow triggers
    switch (entity_name) {
      case 'Lead':
        if (event_type === 'created') {
          triggerType = 'lead_created';
        } else if (event_type === 'updated' && old_data?.status !== entity_data?.status) {
          triggerType = 'lead_status_changed';
          entityData = {
            ...entityData,
            old_status: old_data.status,
            new_status: entity_data.status
          };
        }
        break;

      case 'Customer':
        if (event_type === 'created') {
          triggerType = 'customer_created';
        }
        break;

      case 'Estimate':
        if (event_type === 'created') {
          triggerType = 'estimate_created';
        } else if (event_type === 'updated' && old_data?.status !== entity_data?.status) {
          if (entity_data.status === 'sent') {
            triggerType = 'estimate_sent';
          } else if (entity_data.status === 'accepted') {
            triggerType = 'estimate_accepted';
          }
        }
        break;

      case 'Invoice':
        if (event_type === 'created') {
          triggerType = 'invoice_created';
        } else if (event_type === 'updated' && old_data?.status !== entity_data?.status) {
          if (entity_data.status === 'paid') {
            triggerType = 'invoice_paid';
          } else if (entity_data.status === 'overdue') {
            triggerType = 'invoice_overdue';
          }
        }
        break;

      case 'Payment':
        if (event_type === 'created') {
          triggerType = 'payment_received';
        }
        break;

      case 'Task':
        if (event_type === 'created' && entity_data.assigned_to) {
          triggerType = 'task_assigned';
        } else if (event_type === 'updated') {
          if (old_data?.status !== entity_data?.status) {
            triggerType = 'task_status_changed';
          } else if (old_data?.assigned_to !== entity_data?.assigned_to) {
            triggerType = 'task_assigned';
          }
        }
        break;

      case 'Proposal':
        if (event_type === 'created') {
          triggerType = 'proposal_created';
        } else if (event_type === 'updated' && old_data?.status !== entity_data?.status) {
          triggerType = 'proposal_status_changed';
          entityData = {
            ...entityData,
            old_status: old_data.status,
            new_status: entity_data.status
          };
        }
        break;

      case 'Project':
        if (event_type === 'created') {
          triggerType = 'project_created';
        } else if (event_type === 'updated' && old_data?.status !== entity_data?.status) {
          triggerType = 'project_status_changed';
        }
        break;

      case 'CommissionDeduction':
        if (event_type === 'created') {
          triggerType = 'deduction_added';
        } else if (event_type === 'updated') {
          triggerType = 'deduction_edited';
        }
        break;
    }

    if (!triggerType) {
      console.log('⚠️ No workflow trigger for this event');
      return Response.json({ success: true, message: 'No trigger needed' });
    }

    console.log(`🔔 Triggering: ${triggerType} for ${entity_name}`);

    // Find and execute matching workflows
    const workflows = await base44.asServiceRole.entities.Workflow.filter({
      company_id: companyId,
      trigger_type: triggerType,
      is_active: true
    });

    if (!workflows || workflows.length === 0) {
      console.log('⚠️ No active workflows found for:', triggerType);
      return Response.json({ 
        success: true, 
        message: `No workflows configured for ${triggerType}` 
      });
    }

    console.log(`✅ Found ${workflows.length} workflow(s) to execute`);

    // Execute each workflow
    for (const workflow of workflows) {
      try {
        await base44.asServiceRole.functions.invoke('executeWorkflow', {
          workflow_id: workflow.id,
          entity_data: {
            ...entityData,
            entity_type: entity_name,
            entity_id: entity_id,
            customer_name: entityData?.name || entityData?.customer_name || entityData?.contact_name,
            customer_email: entityData?.email || entityData?.customer_email || entityData?.contact_email,
            customer_phone: entityData?.phone || entityData?.customer_phone || entityData?.contact_phone,
            lead_name: entityData?.name,
            lead_email: entityData?.email,
            lead_phone: entityData?.phone,
            app_url: 'https://getcompanysync.com'
          }
        });
        
        console.log(`✅ Executed workflow: ${workflow.workflow_name}`);
      } catch (error) {
        console.error(`❌ Failed to execute workflow ${workflow.workflow_name}:`, error);
      }
    }

    return Response.json({
      success: true,
      message: `Triggered ${workflows.length} workflows`,
      trigger_type: triggerType,
      workflows_triggered: workflows.map(w => w.workflow_name)
    });

  } catch (error) {
    console.error('💥 Auto-trigger error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});