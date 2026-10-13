import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId } = await req.json();

    // Get all invoices
    const invoices = await base44.asServiceRole.entities.Invoice.filter({ company_id: companyId });
    
    // Get existing customers
    const existingCustomers = await base44.asServiceRole.entities.Customer.filter({ company_id: companyId });
    const existingCustomerNames = new Set(existingCustomers.map(c => c.name?.toLowerCase()));

    // Extract unique customers from invoices
    const customerMap = new Map();
    
    invoices.forEach(invoice => {
      if (!invoice.customer_name) return;
      
      const key = invoice.customer_name.toLowerCase();
      
      // Skip if customer already exists
      if (existingCustomerNames.has(key)) return;
      
      if (!customerMap.has(key)) {
        customerMap.set(key, {
          company_id: companyId,
          name: invoice.customer_name,
          email: invoice.customer_email || '',
          phone: '',
          assigned_to: invoice.sale_agent || user.email,
          assigned_to_users: [invoice.sale_agent || user.email],
          is_active: true,
          source: 'other',
          custom_source: 'Imported from invoices'
        });
      }
    });

    const customersToCreate = Array.from(customerMap.values());
    
    if (customersToCreate.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'All customers already exist',
        created: 0 
      });
    }

    // Create customers in batches
    const batchSize = 50;
    let created = 0;
    
    for (let i = 0; i < customersToCreate.length; i += batchSize) {
      const batch = customersToCreate.slice(i, i + batchSize);
      await base44.asServiceRole.entities.Customer.bulkCreate(batch);
      created += batch.length;
    }

    return Response.json({ 
      success: true, 
      message: `Created ${created} customers from invoices`,
      created 
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});