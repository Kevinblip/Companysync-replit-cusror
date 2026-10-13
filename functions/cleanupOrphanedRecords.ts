import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { dry_run = true } = await req.json().catch(() => ({}));

    const entitiesToClean = [
      'Customer',
      'Lead',
      'Invoice',
      'Estimate',
      'Task',
      'Project',
      'CalendarEvent',
      'Communication',
      'StaffProfile'
    ];

    const report = {
      timestamp: new Date().toISOString(),
      dry_run,
      deleted: {},
      total_deleted: 0
    };

    // Get all valid company IDs
    const companies = await base44.asServiceRole.entities.Company.list();
    const validCompanyIds = new Set(companies.map(c => c.id));

    console.log(`Found ${validCompanyIds.size} valid companies`);

    for (const entityName of entitiesToClean) {
      const records = await base44.asServiceRole.entities[entityName].list();
      const orphaned = [];

      for (const record of records) {
        // Check if company_id exists but points to a non-existent company
        if (record.company_id && !validCompanyIds.has(record.company_id)) {
          orphaned.push(record.id);
        }
      }

      if (orphaned.length > 0) {
        console.log(`${entityName}: Found ${orphaned.length} orphaned records`);
        
        if (!dry_run) {
          let deleted = 0;
          for (const id of orphaned) {
            try {
              await base44.asServiceRole.entities[entityName].delete(id);
              deleted++;
            } catch (e) {
              // Record may have already been deleted - skip
              console.log(`Skipped ${entityName} ${id}: ${e.message}`);
            }
          }
          console.log(`${entityName}: Deleted ${deleted} records`);
        }

        report.deleted[entityName] = orphaned.length;
        report.total_deleted += orphaned.length;
      }
    }

    return Response.json({ 
      success: true, 
      message: dry_run 
        ? `Dry run complete. Would delete ${report.total_deleted} orphaned records.` 
        : `Cleanup complete. Deleted ${report.total_deleted} orphaned records.`,
      report 
    });

  } catch (error) {
    console.error('Cleanup Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});