import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId } = await req.json();

    if (!companyId) {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // Find all default workflows for this company
    const defaultWorkflows = await base44.asServiceRole.entities.Workflow.filter({
      company_id: companyId,
      is_default: true
    });

    console.log(`Found ${defaultWorkflows.length} default workflows to delete`);

    // Delete them
    let deleted = 0;
    for (const workflow of defaultWorkflows) {
      try {
        await base44.asServiceRole.entities.Workflow.delete(workflow.id);
        deleted++;
        console.log(`Deleted: ${workflow.workflow_name}`);
      } catch (error) {
        console.error(`Failed to delete ${workflow.workflow_name}:`, error.message);
      }
    }

    return Response.json({
      success: true,
      message: `Deleted ${deleted} default workflows`,
      deleted_count: deleted
    });

  } catch (error) {
    console.error('Delete default workflows error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});