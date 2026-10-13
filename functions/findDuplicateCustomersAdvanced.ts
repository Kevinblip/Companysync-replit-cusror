import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all customers
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    
    // Group by name (case-insensitive)
    const customersByName = {};
    allCustomers.forEach(customer => {
      const normalizedName = customer.name?.toLowerCase().trim();
      if (!normalizedName) return;
      
      if (!customersByName[normalizedName]) {
        customersByName[normalizedName] = [];
      }
      customersByName[normalizedName].push(customer);
    });
    
    // Find duplicates
    const duplicates = Object.entries(customersByName)
      .filter(([name, customers]) => customers.length > 1)
      .map(([name, customers]) => ({
        name: customers[0].name,
        count: customers.length,
        customers: customers.map(c => ({
          id: c.id,
          company_id: c.company_id,
          created_date: c.created_date,
          address: c.address || `${c.street} ${c.city} ${c.state} ${c.zip}`.trim(),
          assigned_to: c.assigned_to_users || [c.assigned_to],
          email: c.email,
          phone: c.phone
        }))
      }));
    
    return Response.json({
      success: true,
      total_duplicates: duplicates.length,
      duplicates: duplicates
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});