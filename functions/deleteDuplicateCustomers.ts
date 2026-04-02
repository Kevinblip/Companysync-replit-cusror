import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Scanning for duplicate customers...');

    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    console.log(`Found ${allCustomers.length} total customers`);

    // Group by: name + email + phone (last 10 digits)
    const customerGroups = {};
    
    allCustomers.forEach(customer => {
      const name = (customer.name || '').toLowerCase().trim();
      const email = (customer.email || '').toLowerCase().trim();
      const phone = (customer.phone || '').replace(/\D/g, '').slice(-10);
      
      // Skip junk names
      const junkNames = ['[]', 'true', 'false', 'other', 'residential', 'commercial', 'null', 'undefined'];
      if (junkNames.includes(name)) return;
      
      // Create composite key
      let key = name;
      if (email) key += `|${email}`;
      if (phone && phone.length === 10) key += `|${phone}`;
      
      if (!customerGroups[key]) {
        customerGroups[key] = [];
      }
      customerGroups[key].push(customer);
    });

    // Find duplicates - keep the one with most data OR oldest
    const duplicateGroups = Object.entries(customerGroups)
      .filter(([key, customers]) => customers.length > 1)
      .map(([key, customers]) => {
        // Score each customer by data completeness
        const scored = customers.map(c => {
          let score = 0;
          if (c.email) score += 10;
          if (c.phone) score += 10;
          if (c.street) score += 5;
          if (c.city) score += 3;
          if (c.state) score += 2;
          if (c.zip) score += 2;
          if (c.customer_number) score += 5;
          if (c.assigned_to_users?.length > 0) score += 8;
          if (c.total_revenue > 0) score += 15;
          return { customer: c, score };
        });

        // Sort by score DESC, then by created_date ASC (oldest first)
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return new Date(a.customer.created_date) - new Date(b.customer.created_date);
        });

        const toKeep = scored[0].customer;
        const toDelete = scored.slice(1).map(s => s.customer);

        return {
          name: customers[0].name,
          email: customers[0].email,
          phone: customers[0].phone,
          count: customers.length,
          keeping: toKeep.id,
          deleting: toDelete.map(c => c.id)
        };
      });

    console.log(`Found ${duplicateGroups.length} duplicate groups`);

    let deleted = 0;
    const errors = [];
    const deletedList = [];

    for (const group of duplicateGroups) {
      console.log(`🔍 Duplicate: ${group.name} - Keeping 1, deleting ${group.deleting.length}`);
      
      for (const customerId of group.deleting) {
        try {
          const customer = allCustomers.find(c => c.id === customerId);
          await base44.asServiceRole.entities.Customer.delete(customerId);
          deleted++;
          deletedList.push({
            name: customer.name,
            email: customer.email,
            phone: customer.phone
          });

          if (deleted % 10 === 0) {
            console.log(`✅ Deleted ${deleted} duplicate customers...`);
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.error(`❌ Failed to delete customer ${customerId}:`, error.message);
          errors.push({
            customer_id: customerId,
            name: group.name,
            error: error.message
          });
        }
      }
    }

    const remainingCount = allCustomers.length - deleted;

    console.log(`✅ COMPLETE: Deleted ${deleted} duplicate customers, ${remainingCount} remaining`);

    return Response.json({
      success: true,
      message: `Deleted ${deleted} duplicate customers`,
      total_scanned: allCustomers.length,
      duplicate_groups: duplicateGroups.length,
      deleted_count: deleted,
      remaining_count: remainingCount,
      target_count: 737,
      sample_deleted: deletedList.slice(0, 10),
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