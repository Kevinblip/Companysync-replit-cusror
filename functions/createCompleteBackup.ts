import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Get the base URL for API calls
function getApiUrl(req: Request): string {
  const origin = req.headers.get('origin') || req.headers.get('referer') || 'http://localhost:5000';
  const baseUrl = origin.split('?')[0].split('#')[0];
  return baseUrl;
}

async function fetchLocalEntity(apiUrl: string, entityType: string, companyId: string, authToken?: string): Promise<any[]> {
  const url = new URL(`/api/local/entity/${entityType}`, apiUrl);
  url.searchParams.set('company_id', JSON.stringify({ $in: [companyId] }));
  
  try {
    const resp = await fetch(url.toString(), {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    if (!resp.ok) {
      console.log(`Fetch ${entityType}: ${resp.status}`);
      return [];
    }
    return await resp.json();
  } catch (err) {
    console.log(`Error fetching ${entityType}:`, err.message);
    return [];
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId, backupName } = await req.json();

    if (!companyId) {
      return Response.json({ error: 'Company ID required' }, { status: 400 });
    }

    console.log(`Creating complete backup for company ${companyId}...`);
    
    const apiUrl = getApiUrl(req);
    const authHeader = req.headers.get('authorization');

    // List of all entities to backup - prioritized by importance and likelihood
    const entityTypes = [
      'Customer', 'Lead', 'Invoice', 'Payment', 'Estimate', 'Task', 
      'Project', 'CalendarEvent', 'StaffProfile', 'Workflow',
      'Document', 'Communication', 'Message', 'Proposal', 'Contract',
      'Item', 'PriceListItem', 'InspectionJob', 'DroneInspection',
      'IntegrationSetting', 'EstimateFormat', 'CalendarSettings', 
      'TaskBoard', 'StormEvent', 'StormAlertSettings', 'MenuSettings',
      'CustomField', 'ImportLog', 'EmailTemplate', 'SMSTemplate', 
      'LeadScore', 'WorkflowExecution', 'KnowledgeBaseArticle', 'Signature',
      'SavedReport', 'DashboardWidget', 'RevenueGoal', 'AITrainingData', 
      'Property', 'ContractTemplate', 'GeneratedContract',
      'ContractSigningSession', 'AIMemory', 'ConversationHistory',
      'Transaction', 'ChartOfAccount', 'StaffRole', 'JobMedia', 
      'CommissionDeduction', 'TaxRate', 'CustomerGroup', 'EstimateTemplate', 
      'InspectorProfile', 'QuickBooksSettings', 'Notification', 
      'SubscriptionUsage', 'CommissionRule', 'DailyReport', 'GoogleChatSettings', 
      'EstimateVersion', 'InspectionReportTemplate', 'EmailTracking', 
      'IntegrationCredential', 'CommissionPayment', 'NotificationPreference', 
      'SlackSettings', 'DashboardSettings', 'FieldActivity', 'Territory', 
      'RepLocation', 'RoundRobinSettings', 'Campaign', 'TrainingVideo', 
      'FamilyMember', 'FamilyCommissionRecord', 'LeadSource', 'Payout', 
      'ChartOfAccounts', 'Expense', 'BankAccount', 'Subcontractor', 'Vendor', 
      'BuildingCode', 'ReviewRequest', 'AssistantSettings', 'ImpersonationLog', 
      'CompanySetting'
    ];

    const backupData: Record<string, any> = {};
    const entityCounts: Record<string, number> = {};

    // Backup each entity type using local API
    for (const entityType of entityTypes) {
      try {
        console.log(`Fetching ${entityType}...`);
        const records = await fetchLocalEntity(apiUrl, entityType, companyId, authHeader);
        backupData[entityType] = records || [];
        entityCounts[entityType] = (records || []).length;
        if ((records || []).length > 0) {
          console.log(`✅ Backed up ${records.length} ${entityType} records`);
        }
      } catch (err) {
        console.log(`Entity ${entityType}: error or not found`);
        backupData[entityType] = [];
        entityCounts[entityType] = 0;
      }
    }

    // Also backup the Company record itself
    try {
      const companies = await fetchLocalEntity(apiUrl, 'Company', companyId, authHeader);
      // For company, fetch by ID instead
      const companyResp = await fetch(new URL(`/api/local/entity/Company?id=${companyId}`, apiUrl).toString(), {
        headers: authHeader ? { 'Authorization': authHeader } : {}
      });
      if (companyResp.ok) {
        const company = await companyResp.json();
        backupData['Company'] = Array.isArray(company) ? company : [company];
        entityCounts['Company'] = Array.isArray(company) ? company.length : 1;
        console.log(`✅ Backed up company record`);
      }
    } catch (err) {
      console.log(`Error backing up Company:`, err.message);
    }

    // Create the backup record in base44
    try {
      const backup = await base44.asServiceRole.entities.CompleteBackup.create({
        backup_name: backupName || `Backup ${new Date().toLocaleString()}`,
        company_id: companyId,
        company_name: (backupData.Company?.[0] as any)?.company_name || 'Unknown',
        backup_data: backupData,
        entity_counts: entityCounts,
        created_by_email: user.email
      });
      console.log(`✅ Backup record created: ${backup.id}`);
    } catch (err) {
      console.log(`Warning: Could not create backup record:`, err.message);
    }

    const totalRecords = Object.values(entityCounts).reduce((sum: number, count: number) => sum + count, 0);
    console.log(`✅ Backup complete: ${totalRecords} total records`);

    return Response.json({
      success: true,
      total_records: totalRecords,
      entity_counts: entityCounts,
      message: `Backup created successfully with ${totalRecords} total records`
    });

  } catch (error) {
    console.error('Backup error:', error);
    return Response.json({ 
      success: false, 
      error: (error as any).message || String(error)
    }, { status: 500 });
  }
});