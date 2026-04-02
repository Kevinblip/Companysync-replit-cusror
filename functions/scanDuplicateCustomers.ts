import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 SCAN ONLY - Finding duplicate customers (no deletion)...');

    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    console.log(`📊 Scanning ${allCustomers.length} customers`);

    // Group by: name + email + phone (last 10 digits)
    const customerGroups = {};
    
    allCustomers.forEach(customer => {
      const name = (customer.name || '').toLowerCase().trim();
      const email = (customer.email || '').toLowerCase().trim();
      const phone = (customer.phone || '').replace(/\D/g, '').slice(-10);
      
      // Skip junk names
      const junkNames = ['[]', 'true', 'false', 'other', 'residential', 'commercial', 'null', 'undefined', ''];
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

    // Find duplicates - show what would be kept vs deleted
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
          email: customers[0].email || '',
          phone: customers[0].phone || '',
          count: customers.length,
          will_keep: {
            id: toKeep.id,
            customer_number: toKeep.customer_number,
            email: toKeep.email || '',
            phone: toKeep.phone || '',
            created_date: toKeep.created_date,
            score: scored[0].score
          },
          will_delete: toDelete.map((c, idx) => ({
            id: c.id,
            customer_number: c.customer_number,
            email: c.email || '',
            phone: c.phone || '',
            created_date: c.created_date,
            score: scored[idx + 1].score
          }))
        };
      });

    console.log(`✅ SCAN COMPLETE: Found ${duplicateGroups.length} duplicate groups`);

    return Response.json({
      success: true,
      scan_only: true,
      message: 'This is a read-only scan. No data was deleted.',
      summary: {
        total_customers: allCustomers.length,
        duplicate_groups_found: duplicateGroups.length,
        total_duplicates_to_delete: duplicateGroups.reduce((sum, g) => sum + g.will_delete.length, 0),
        customers_after_cleanup: allCustomers.length - duplicateGroups.reduce((sum, g) => sum + g.will_delete.length, 0)
      },
      duplicate_groups: duplicateGroups,
      recommendation: duplicateGroups.length > 0 
        ? `Found ${duplicateGroups.length} groups with duplicates. Review the details below before deleting.`
        : '✅ No duplicates found! Your customer data is clean.'
    });

  } catch (error) {
    console.error('Scan error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});