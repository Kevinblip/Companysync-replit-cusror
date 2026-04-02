import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can restore
    if (user.role !== 'admin') {
      return Response.json({ error: 'Only admins can restore backups' }, { status: 403 });
    }

    const { backupId, deleteExistingData } = await req.json();

    if (!backupId) {
      return Response.json({ error: 'Backup ID required' }, { status: 400 });
    }

    console.log(`Restoring from backup ${backupId}...`);

    // Fetch the backup
    const backups = await base44.asServiceRole.entities.CompleteBackup.filter({ 
      id: backupId 
    });

    if (backups.length === 0) {
      return Response.json({ error: 'Backup not found' }, { status: 404 });
    }

    const backup = backups[0];
    const backupData = backup.backup_data;
    const companyId = backup.company_id;

    console.log(`Found backup: ${backup.backup_name}`);
    console.log(`Company: ${backup.company_name}`);

    // If requested, delete existing data first
    if (deleteExistingData) {
      console.log('Deleting existing data...');
      
      for (const [entityType, records] of Object.entries(backupData)) {
        if (entityType === 'Company') continue; // Don't delete the company itself
        
        try {
          const existingRecords = await base44.asServiceRole.entities[entityType].filter({ 
            company_id: companyId 
          });
          
          for (const record of existingRecords) {
            await base44.asServiceRole.entities[entityType].delete(record.id);
          }
          
          console.log(`Deleted ${existingRecords.length} existing ${entityType} records`);
        } catch (err) {
          console.log(`Error deleting ${entityType}: ${err.message}`);
        }
      }
    }

    // Restore each entity type
    const restoredCounts = {};
    
    for (const [entityType, records] of Object.entries(backupData)) {
      if (entityType === 'Company') {
        // Update the company instead of creating
        if (records.length > 0) {
          const companyData = { ...records[0] };
          delete companyData.id;
          delete companyData.created_date;
          delete companyData.updated_date;
          
          try {
            await base44.asServiceRole.entities.Company.update(companyId, companyData);
            console.log(`Updated Company record`);
          } catch (err) {
            console.log(`Error updating Company: ${err.message}`);
          }
        }
        continue;
      }

      if (!records || records.length === 0) continue;

      try {
        for (const record of records) {
          const recordData = { ...record };
          
          // Remove system-generated fields
          delete recordData.id;
          delete recordData.created_date;
          delete recordData.updated_date;
          delete recordData.created_by;
          
          await base44.asServiceRole.entities[entityType].create(recordData);
        }
        
        restoredCounts[entityType] = records.length;
        console.log(`Restored ${records.length} ${entityType} records`);
      } catch (err) {
        console.error(`Error restoring ${entityType}:`, err.message);
        restoredCounts[entityType] = 0;
      }
    }

    const totalRestored = Object.values(restoredCounts).reduce((sum, count) => sum + count, 0);

    return Response.json({
      success: true,
      total_restored: totalRestored,
      restored_counts: restoredCounts,
      message: `Successfully restored ${totalRestored} records`
    });

  } catch (error) {
    console.error('Restore error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});