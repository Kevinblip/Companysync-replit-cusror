import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    
    console.log(`Total customers found: ${allCustomers.length}`);

    // Identify junk patterns
    const junkPatterns = [
      '[]',
      'true',
      'false',
      'other',
      'residential',
      'commercial',
      'stonekevin866@gmail.com',
      '["stonekevin866@gmail.com"]',
      '[\"stonekevin866@gmail.com\"]',
      'imported from invoices',
      'no permission!',
      'null',
      'undefined'
    ];

    const junkCustomers = allCustomers.filter(c => {
      const name = (c.name || '').toLowerCase().trim();
      return junkPatterns.some(pattern => name === pattern.toLowerCase());
    });

    console.log(`Found ${junkCustomers.length} junk customers to delete`);

    let deleted = 0;
    const errors = [];

    for (const customer of junkCustomers) {
      try {
        await base44.asServiceRole.entities.Customer.delete(customer.id);
        deleted++;
        
        if (deleted % 50 === 0) {
          console.log(`✅ Deleted ${deleted}/${junkCustomers.length} customers...`);
        }
      } catch (error) {
        console.error(`❌ Failed to delete customer ${customer.id}:`, error.message);
        errors.push({ 
          id: customer.id, 
          name: customer.name,
          error: error.message 
        });
      }
    }

    console.log(`✅ COMPLETE: Deleted ${deleted} junk customers`);

    return Response.json({
      success: true,
      message: `Successfully deleted ${deleted} junk customers`,
      total_found: junkCustomers.length,
      deleted: deleted,
      patterns_used: junkPatterns,
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