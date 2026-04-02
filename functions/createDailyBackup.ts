import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔄 Starting daily backup...');

    // Get company info
    let myCompany;
    const { companyId } = await req.json().catch(() => ({}));

    if (companyId) {
      const companies = await base44.entities.Company.filter({ id: companyId });
      myCompany = companies[0];
    } else {
      const companies = await base44.entities.Company.list("-created_date", 10);
      myCompany = companies.find(c => c.created_by === user.email) || companies[0];
    }

    if (!myCompany) {
      return Response.json({ error: 'No company found' }, { status: 404 });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const backupData = {
      backup_date: new Date().toISOString(),
      company_name: myCompany.company_name,
      company_id: myCompany.id,
      data: {}
    };

    // Fetch all entity data
    const entities = [
      'Customer',
      'Lead',
      'Invoice',
      'Estimate',
      'Payment',
      'Project',
      'Task',
      'CalendarEvent',
      'Communication',
      'StaffProfile',
      'Proposal',
      'Contract',
      'Document',
      'Item',
      'InspectionJob',
      'DroneInspection',
      'PriceListItem'
    ];

    for (const entityName of entities) {
      try {
        console.log(`Backing up ${entityName}...`);
        const records = await base44.entities[entityName].filter({ company_id: myCompany.id });
        backupData.data[entityName] = records;
        console.log(`✅ ${entityName}: ${records.length} records`);
      } catch (error) {
        console.log(`⚠️ ${entityName}: ${error.message}`);
        backupData.data[entityName] = [];
      }
    }

    // Convert to JSON string
    const jsonBackup = JSON.stringify(backupData, null, 2);
    const backupBlob = new Blob([jsonBackup], { type: 'application/json' });

    // Create a downloadable file URL
    const fileName = `backup_${myCompany.company_name.replace(/\s+/g, '_')}_${timestamp}.json`;

    // Store backup as a Document record
    try {
      await base44.entities.Document.create({
        company_id: myCompany.id,
        title: `Daily Backup - ${timestamp}`,
        category: 'backup',
        description: `Automated daily backup created on ${timestamp}`,
        file_name: fileName,
        created_by: user.email,
        tags: ['backup', 'automated']
      });
    } catch (error) {
      console.log('Could not save backup record:', error.message);
    }

    // Calculate total records
    const totalRecords = Object.values(backupData.data).reduce((sum, records) => sum + records.length, 0);

    console.log(`✅ Backup complete: ${totalRecords} total records`);

    // Return the backup as a downloadable JSON
    return new Response(jsonBackup, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });

  } catch (error) {
    console.error('Backup error:', error);
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});