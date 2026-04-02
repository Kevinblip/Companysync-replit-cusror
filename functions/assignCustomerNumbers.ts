import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get ALL customers sorted by created_date ASCENDING (oldest first)
    console.log('Fetching all customers...');
    const customers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    
    // REVERSE so oldest is first
    customers.reverse();
    
    console.log(`Found ${customers.length} customers to number`);
    console.log(`First customer (oldest): ${customers[0]?.name} - ${customers[0]?.created_date}`);
    console.log(`Last customer (newest): ${customers[customers.length - 1]?.name} - ${customers[customers.length - 1]?.created_date}`);

    let updated = 0;
    let errors = 0;
    const errorDetails = [];

    // Assign numbers 1, 2, 3... (oldest gets 1, newest gets highest)
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      const customerNumber = i + 1; // 1, 2, 3, 4... 486
      
      try {
        // Only update customer_number, don't touch other fields
        await base44.asServiceRole.entities.Customer.update(customer.id, {
          customer_number: customerNumber
        });
        updated++;
        
        if (updated % 50 === 0) {
          console.log(`✅ Assigned numbers to ${updated} customers...`);
        }
      } catch (error) {
        console.error(`❌ Failed to update customer ${customer.id} (${customer.name}):`, error.message);
        errors++;
        errorDetails.push({
          id: customer.id,
          name: customer.name,
          error: error.message
        });
      }
    }

    console.log(`✅ COMPLETE: ${updated} customers numbered, ${errors} errors`);

    return Response.json({
      success: errors === 0,
      message: errors === 0 
        ? `Successfully assigned customer numbers!` 
        : `Assigned ${updated} numbers, but ${errors} failed`,
      total_customers: customers.length,
      updated: updated,
      errors: errors,
      first_customer: customers[0]?.name + ' = #1',
      last_customer: customers[customers.length - 1]?.name + ` = #${customers.length}`,
      sample_errors: errorDetails.slice(0, 10)
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});