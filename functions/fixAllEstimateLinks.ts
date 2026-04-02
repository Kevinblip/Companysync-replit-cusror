import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔗 Linking ALL estimates to customers...');

    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);

    console.log(`📊 Found ${allEstimates.length} estimates and ${allCustomers.length} customers`);

    // Create a map for faster lookup with normalized names
    const customerMap = new Map();
    allCustomers.forEach(customer => {
      const normalizedName = customer.name?.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ');
      if (normalizedName) {
        customerMap.set(normalizedName, customer);
      }
    });

    let linked = 0;
    let skipped = 0;
    let notFound = [];

    for (const estimate of allEstimates) {
      try {
        if (!estimate.customer_name) {
          skipped++;
          continue;
        }

        // Normalize estimate customer name
        const normalizedEstimateName = estimate.customer_name.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ');
        
        // Try direct match first
        let matchingCustomer = customerMap.get(normalizedEstimateName);
        
        // If no match, try reversing name (e.g., "HILL, GINA" -> "gina hill")
        if (!matchingCustomer && estimate.customer_name.includes(',')) {
          const parts = estimate.customer_name.split(',').map(p => p.trim());
          const reversed = `${parts[1]} ${parts[0]}`.toLowerCase().trim();
          matchingCustomer = customerMap.get(reversed);
        }

        if (matchingCustomer) {
          await base44.asServiceRole.entities.Estimate.update(estimate.id, {
            customer_id: matchingCustomer.id,
            company_id: matchingCustomer.company_id
          });
          linked++;
          console.log(`✅ [${linked}] Linked ${estimate.estimate_number} to ${matchingCustomer.name}`);
          
          // Rate limiting
          if (linked % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } else {
          notFound.push({
            estimate_number: estimate.estimate_number,
            customer_name: estimate.customer_name
          });
          skipped++;
        }
      } catch (error) {
        console.error(`❌ Failed ${estimate.estimate_number}:`, error.message);
        skipped++;
      }
    }

    return Response.json({
      success: true,
      linked,
      skipped,
      total: allEstimates.length,
      notFound: notFound.slice(0, 20), // Only show first 20 not found
      message: `✅ Linked ${linked} estimates to customers. ${skipped} skipped.`
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});