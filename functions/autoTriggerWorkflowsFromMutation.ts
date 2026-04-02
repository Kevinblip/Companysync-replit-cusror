import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// 🚀 UNIVERSAL WORKFLOW TRIGGER - Called from frontend after mutations
// Automatically routes entity changes to the correct workflow triggers

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const body = await req.json();
    console.log('📥 autoTriggerWorkflowsFromMutation received:', body);

    const {
      action, // 'create' | 'update' | 'delete'
      entityType, // 'Customer', 'Lead', 'Invoice', etc.
      entityId,
      entityData,
      oldData, // For updates, contains previous values
      companyId
    } = body;

    if (!companyId || !entityType) {
      console.log('⚠️ Missing required fields');
      return Response.json({ success: true, message: 'Missing fields' });
    }

    let triggerType = null;

    // Map entity actions to workflow triggers
    switch (entityType) {
      case 'Lead':
        if (action === 'create') {
          triggerType = 'lead_created';
        } else if (action === 'update' && oldData?.status !== entityData?.status) {
          triggerType = 'lead_status_changed';
        }
        break;

      case 'Customer':
        if (action === 'create') {
          triggerType = 'customer_created';
        }
        break;

      case 'Estimate':
        if (action === 'create') {
          triggerType = 'estimate_created';
        } else if (action === 'update' && oldData?.status !== entityData?.status) {
          if (entityData.status === 'sent') {
            triggerType = 'estimate_sent';
          } else if (entityData.status === 'accepted') {
            triggerType = 'estimate_accepted';
          }
        }
        break;

      case 'Invoice':
        if (action === 'create') {
          triggerType = 'invoice_created';
        } else if (action === 'update' && oldData?.status !== entityData?.status) {
          if (entityData.status === 'paid') {
            triggerType = 'invoice_paid';
          } else if (entityData.status === 'overdue') {
            triggerType = 'invoice_overdue';
          }
        }
        break;

      case 'Payment':
        if (action === 'create') {
          triggerType = 'payment_received';
        }
        break;

      case 'Task':
        if (action === 'create' && entityData.assigned_to) {
          triggerType = 'task_assigned';
        } else if (action === 'update') {
          if (oldData?.status !== entityData?.status) {
            triggerType = 'task_status_changed';
          } else if (oldData?.assigned_to !== entityData?.assigned_to) {
            triggerType = 'task_assigned';
          }
        }
        break;

      case 'Proposal':
        if (action === 'create') {
          triggerType = 'proposal_created';
        } else if (action === 'update' && oldData?.status !== entityData?.status) {
          if (entityData.status === 'accepted') {
            triggerType = 'proposal_accepted';
          } else {
            triggerType = 'proposal_status_changed';
          }
        }
        break;

      case 'Project':
        if (action === 'create') {
          triggerType = 'project_created';
        } else if (action === 'update' && oldData?.status !== entityData?.status) {
          triggerType = 'project_status_changed';
          if (entityData.status === 'completed') {
            triggerType = 'project_completed';
          }
        }
        break;

      case 'CalendarEvent':
        if (action === 'create') {
          triggerType = 'event_created';
        } else if (action === 'update' && oldData?.start_time !== entityData?.start_time) {
          triggerType = 'event_rescheduled';
        } else if (action === 'update' && oldData?.status !== entityData?.status && entityData?.status === 'completed') {
          triggerType = 'appointment_completed';
        }
        break;

      case 'InspectionJob':
        if (action === 'create') {
          triggerType = 'inspection_created';
        } else if (action === 'update' && oldData?.status !== entityData?.status) {
          if (entityData.status === 'completed') {
            triggerType = 'inspection_completed';
          }
        }
        break;

      case 'CommissionDeduction':
        if (action === 'create') {
          triggerType = 'deduction_added';
        }
        break;

      case 'ReviewRequest':
        if (action === 'create') {
          triggerType = 'review_requested';
        }
        break;
    }

    if (!triggerType) {
      console.log('⚠️ No workflow trigger for:', entityType, action);
      return Response.json({ success: true, message: 'No trigger needed' });
    }

    console.log(`🔔 Triggering: ${triggerType} for ${entityType}`);

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
            entity_type: entityType,
            entity_id: entityId,
            // Normalize field names for all entities
            customer_name: entityData?.name || entityData?.customer_name || entityData?.contact_name,
            customer_email: entityData?.email || entityData?.customer_email || entityData?.contact_email,
            customer_phone: entityData?.phone || entityData?.customer_phone || entityData?.contact_phone,
            lead_name: entityData?.name,
            lead_email: entityData?.email,
            lead_phone: entityData?.phone,
            app_url: entityData?.app_url || 'https://getcompanysync.com'
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