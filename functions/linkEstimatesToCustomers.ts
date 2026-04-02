import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔗 Starting to link estimates to customers...');

    // Get all estimates and all customers
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);

    console.log(`Found ${allEstimates.length} estimates and ${allCustomers.length} customers`);

    let linked = 0;
    let skipped = 0;
    let errors = [];

    for (const estimate of allEstimates) {
      try {
        // Skip if already has customer_id
        if (estimate.customer_id) {
          skipped++;
          continue;
        }

        // Find matching customer by name
        if (!estimate.customer_name) {
          console.log(`⚠️ Estimate ${estimate.estimate_number} has no customer_name`);
          skipped++;
          continue;
        }

        const matchingCustomer = allCustomers.find(c => 
          c.name?.toLowerCase().trim() === estimate.customer_name?.toLowerCase().trim()
        );

        if (matchingCustomer) {
          await base44.asServiceRole.entities.Estimate.update(estimate.id, {
            customer_id: matchingCustomer.id,
            company_id: matchingCustomer.company_id || estimate.company_id
          });
          linked++;
          console.log(`✅ Linked ${estimate.estimate_number} to customer ${matchingCustomer.name}`);
          
          // Add small delay every 5 updates to avoid rate limits
          if (linked % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } else {
          console.log(`⚠️ No customer found for estimate ${estimate.estimate_number} (${estimate.customer_name})`);
          skipped++;
        }
      } catch (error) {
        errors.push({
          estimate: estimate.estimate_number,
          error: error.message
        });
        console.error(`❌ Failed to link estimate ${estimate.estimate_number}:`, error);
      }
    }

    return Response.json({
      success: true,
      linked,
      skipped,
      total: allEstimates.length,
      errors
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});