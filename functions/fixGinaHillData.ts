import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the current valid company
    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 100);
    const targetCompanyId = companies[0].id;
    
    console.log(`✅ Target company: ${companies[0].company_name} (${targetCompanyId})`);

    // Find Gina Hill customer
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    const ginaCustomer = allCustomers.find(c => c.name?.toLowerCase().includes('gina hill'));
    
    if (!ginaCustomer) {
      return Response.json({ error: 'Gina Hill customer not found' }, { status: 404 });
    }
    
    console.log(`Found Gina Hill customer: ${ginaCustomer.id} with company_id: ${ginaCustomer.company_id}`);

    // Find all Gina Hill estimates
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    const ginaEstimates = allEstimates.filter(e => 
      e.customer_name?.toLowerCase().includes('gina hill')
    );
    
    console.log(`Found ${ginaEstimates.length} estimates for Gina Hill`);

    let updated = {
      customer: false,
      estimates: []
    };

    // Update customer company_id if needed
    if (ginaCustomer.company_id !== targetCompanyId) {
      await base44.asServiceRole.entities.Customer.update(ginaCustomer.id, {
        company_id: targetCompanyId
      });
      updated.customer = true;
      console.log(`✅ Updated Gina Hill customer to company_id: ${targetCompanyId}`);
    }

    // Update all estimates company_id and link to customer
    for (const estimate of ginaEstimates) {
      if (estimate.company_id !== targetCompanyId || estimate.customer_id !== ginaCustomer.id) {
        await base44.asServiceRole.entities.Estimate.update(estimate.id, {
          company_id: targetCompanyId,
          customer_id: ginaCustomer.id
        });
        updated.estimates.push(estimate.estimate_number);
        console.log(`✅ Updated estimate ${estimate.estimate_number} to company_id: ${targetCompanyId}`);
      }
    }

    return Response.json({
      success: true,
      message: 'Fixed Gina Hill data',
      updated: updated,
      ginaCustomerId: ginaCustomer.id,
      estimatesFound: ginaEstimates.length
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});