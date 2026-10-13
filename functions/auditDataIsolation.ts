import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitiesToCheck = [
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
      summary: 'Data Isolation Audit',
      total_companies: 0,
      orphaned_records: {},
      cross_tenant_risks: []
    };

    // 1. Get all valid companies
    const companies = await base44.asServiceRole.entities.Company.list();
    const companyIds = new Set(companies.map(c => c.id));
    report.total_companies = companies.length;

    // 2. Check each entity for orphaned records or invalid company_ids
    for (const entityName of entitiesToCheck) {
      const records = await base44.asServiceRole.entities[entityName].list();
      let orphaned = 0;
      let invalidCompany = 0;

      for (const record of records) {
        if (!record.company_id) {
          orphaned++;
        } else if (!companyIds.has(record.company_id)) {
          invalidCompany++;
        }
      }

      if (orphaned > 0 || invalidCompany > 0) {
        report.orphaned_records[entityName] = {
          missing_company_id: orphaned,
          invalid_company_id: invalidCompany
        };
      }
    }

    // 3. Check for Users with access to multiple companies (StaffProfile check)
    const staff = await base44.asServiceRole.entities.StaffProfile.list();
    const userCompanyMap = {};

    for (const s of staff) {
      if (!s.user_email) continue;
      if (!userCompanyMap[s.user_email]) {
        userCompanyMap[s.user_email] = new Set();
      }
      if (s.company_id) {
        userCompanyMap[s.user_email].add(s.company_id);
      }
    }

    const multiTenantUsers = [];
    for (const [email, cids] of Object.entries(userCompanyMap)) {
      if (cids.size > 1) {
        multiTenantUsers.push({ email, company_count: cids.size });
      }
    }

    if (multiTenantUsers.length > 0) {
      report.cross_tenant_risks.push({
        type: 'Multi-Tenant Access',
        description: 'Users found with StaffProfiles in multiple companies',
        count: multiTenantUsers.length,
        details: multiTenantUsers
      });
    }

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('Audit Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});