import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🚀 FORCE LINKING ALL ESTIMATES...');

    // Use service role to bypass RLS
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);

    console.log(`📊 Found ${allEstimates.length} estimates, ${allCustomers.length} customers`);

    // Create lookup map
    const customerMap = new Map();
    allCustomers.forEach(c => {
      if (!c.name) return;
      
      // Add multiple normalized variations
      const normalized = c.name.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ');
      customerMap.set(normalized, c);
      
      // Handle "LAST, FIRST" format
      if (c.name.includes(',')) {
        const parts = c.name.split(',').map(p => p.trim());
        if (parts.length === 2) {
          const reversed = `${parts[1]} ${parts[0]}`.toLowerCase().trim();
          customerMap.set(reversed, c);
        }
      }
      
      // Also store original for exact match
      customerMap.set(c.name.toLowerCase().trim(), c);
    });

    let linked = 0;
    let notFound = [];

    for (const est of allEstimates) {
      try {
        if (!est.customer_name) {
          continue;
        }

        // Try multiple variations
        const normalized = est.customer_name.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ');
        let customer = customerMap.get(normalized);
        
        if (!customer) {
          customer = customerMap.get(est.customer_name.toLowerCase().trim());
        }
        
        if (!customer && est.customer_name.includes(',')) {
          const parts = est.customer_name.split(',').map(p => p.trim());
          if (parts.length === 2) {
            const reversed = `${parts[1]} ${parts[0]}`.toLowerCase().trim();
            customer = customerMap.get(reversed);
          }
        }

        if (customer) {
          await base44.asServiceRole.entities.Estimate.update(est.id, {
            customer_id: customer.id,
            company_id: customer.company_id
          });
          linked++;
          console.log(`✅ [${linked}] ${est.estimate_number} → ${customer.name}`);
          
          if (linked % 5 === 0) {
            await new Promise(r => setTimeout(r, 200));
          }
        } else {
          notFound.push({
            id: est.id,
            number: est.estimate_number,
            name: est.customer_name
          });
        }
      } catch (err) {
        console.error(`❌ ${est.estimate_number}:`, err.message);
      }
    }

    return Response.json({
      success: true,
      linked,
      total: allEstimates.length,
      notFound: notFound.slice(0, 10),
      message: `✅ Linked ${linked}/${allEstimates.length} estimates`
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});