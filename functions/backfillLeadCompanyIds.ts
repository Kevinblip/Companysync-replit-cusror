import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Backfills company_id for all leads that are missing it
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔄 Starting lead company_id backfill...');

    // Get user's company
    const companies = await base44.asServiceRole.entities.Company.list();
    const myCompany = companies.find(c => c.created_by === user.email);

    if (!myCompany) {
      return Response.json({ error: 'No company found for this user' }, { status: 404 });
    }

    console.log('✅ Found company:', myCompany.company_name, '(ID:', myCompany.id + ')');

    // Get all leads without company_id
    const allLeads = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
    const leadsWithoutCompany = allLeads.filter(lead => !lead.company_id);

    console.log(`📋 Found ${leadsWithoutCompany.length} leads without company_id`);

    if (leadsWithoutCompany.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'All leads already have company_id',
        updated: 0 
      });
    }

    // Update all leads
    let updated = 0;
    let failed = 0;

    for (const lead of leadsWithoutCompany) {
      try {
        await base44.asServiceRole.entities.Lead.update(lead.id, {
          ...lead,
          company_id: myCompany.id
        });
        updated++;
        console.log(`✅ Updated lead: ${lead.name} (${lead.id})`);
      } catch (error) {
        console.error(`❌ Failed to update lead ${lead.id}:`, error.message);
        failed++;
      }
    }

    console.log(`🎉 Backfill complete! Updated: ${updated}, Failed: ${failed}`);

    return Response.json({ 
      success: true, 
      updated,
      failed,
      companyId: myCompany.id,
      companyName: myCompany.company_name
    });

  } catch (error) {
    console.error('❌ Backfill error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});