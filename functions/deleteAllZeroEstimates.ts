import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get ALL estimates
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    
    console.log(`Total estimates found: ${allEstimates.length}`);

    // Filter for zero-dollar estimates
    const zeroEstimates = allEstimates.filter(est => {
      const amount = parseFloat(est.amount || 0);
      return amount === 0 || amount === 0.0;
    });

    console.log(`Found ${zeroEstimates.length} zero-dollar estimates to delete`);

    let deleted = 0;
    const errors = [];

    for (const estimate of zeroEstimates) {
      try {
        await base44.asServiceRole.entities.Estimate.delete(estimate.id);
        deleted++;
        
        if (deleted % 50 === 0) {
          console.log(`✅ Deleted ${deleted}/${zeroEstimates.length} estimates...`);
        }
      } catch (error) {
        console.error(`❌ Failed to delete estimate ${estimate.id}:`, error.message);
        errors.push({ 
          id: estimate.id, 
          estimate_number: estimate.estimate_number,
          customer: estimate.customer_name,
          error: error.message 
        });
      }
    }

    console.log(`✅ COMPLETE: Deleted ${deleted} zero-dollar estimates`);

    return Response.json({
      success: true,
      message: `Successfully deleted ${deleted} zero-dollar estimates`,
      total_found: zeroEstimates.length,
      deleted: deleted,
      errors: errors.length > 0 ? errors.slice(0, 10) : []
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});