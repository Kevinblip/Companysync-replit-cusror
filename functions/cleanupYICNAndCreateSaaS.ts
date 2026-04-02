import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    console.log(`🧹 Starting cleanup for user: ${user.email}`);

    // Step 1: Find all YICN Roofing companies
    const companies = await base44.asServiceRole.entities.Company.list();
    const yicnCompanies = companies.filter(c => 
      c.company_name?.toLowerCase().includes('yicn') || 
      c.company_name?.toLowerCase().includes('roofing')
    );

    console.log(`Found ${yicnCompanies.length} YICN companies to clean up`);

    const deletedData = {
      companies: [],
      customers: 0,
      leads: 0,
      invoices: 0,
      estimates: 0,
      tasks: 0,
      payments: 0,
      staff: 0,
      expenses: 0,
      transactions: 0
    };

    // Step 2: Delete all data associated with YICN companies
    for (const company of yicnCompanies) {
      console.log(`Deleting data for company: ${company.company_name}`);
      deletedData.companies.push(company.company_name);

      const entityTypes = [
        'Customer', 'Lead', 'Invoice', 'Estimate', 'Task', 'Payment',
        'StaffProfile', 'Expense', 'Transaction', 'Project', 'Communication',
        'CalendarEvent', 'Document', 'Proposal', 'Contract'
      ];

      for (const entityType of entityTypes) {
        try {
          const records = await base44.asServiceRole.entities[entityType].filter({ 
            company_id: company.id 
          });
          
          for (const record of records) {
            await base44.asServiceRole.entities[entityType].delete(record.id);
          }
          
          const key = entityType.toLowerCase() + 's';
          if (deletedData[key] !== undefined) {
            deletedData[key] += records.length;
          }
          
          console.log(`Deleted ${records.length} ${entityType} records`);
        } catch (err) {
          console.log(`Error deleting ${entityType}: ${err.message}`);
        }
      }

      // Delete the company itself
      await base44.asServiceRole.entities.Company.delete(company.id);
    }

    // Step 3: Create CompanySync SaaS Platform
    console.log('🚀 Creating CompanySync SaaS Platform...');
    
    const companySyncData = {
      company_name: 'CompanySync',
      company_tagline: 'AI-Powered Business Management Platform',
      email: user.email,
      phone: '',
      industry: 'other',
      subscription_plan: 'enterprise',
      subscription_status: 'active',
      setup_completed: true,
      setup_completed_at: new Date().toISOString(),
      settings: {
        enable_sms: true,
        enable_calling: true,
        enable_email: true,
        enable_ai_estimator: true,
        time_zone: 'America/New_York',
        date_format: 'MM/DD/YYYY',
        currency: 'USD'
      }
    };

    const companySync = await base44.asServiceRole.entities.Company.create(companySyncData);
    console.log(`✅ Created CompanySync with ID: ${companySync.id}`);

    // Step 4: Create admin staff profile for the user
    const adminProfile = await base44.asServiceRole.entities.StaffProfile.create({
      company_id: companySync.id,
      user_email: user.email,
      full_name: user.full_name || 'Admin',
      is_administrator: true,
      is_super_admin: true,
      can_access_accounting: true,
      status: 'active'
    });

    console.log(`✅ Created admin staff profile`);

    return Response.json({
      success: true,
      message: '🎉 Cleanup complete! CompanySync is ready.',
      deleted: deletedData,
      created: {
        company_id: companySync.id,
        company_name: companySync.company_name,
        admin_profile_id: adminProfile.id
      }
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});