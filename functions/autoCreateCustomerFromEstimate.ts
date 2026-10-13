import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { event, data } = await req.json();

    // Only run on estimate creation
    if (event.type !== 'create' || event.entity_name !== 'Estimate') {
      return Response.json({ success: true, message: 'Not an estimate creation event' });
    }

    const estimate = data;
    
    if (!estimate.customer_name || !estimate.company_id) {
      return Response.json({ success: true, message: 'Missing customer_name or company_id' });
    }

    // Check if customer already exists
    const existingCustomers = await base44.asServiceRole.entities.Customer.filter({
      company_id: estimate.company_id,
      name: estimate.customer_name
    });

    if (existingCustomers && existingCustomers.length > 0) {
      const existingCustomer = existingCustomers[0];
      console.log(`Customer "${estimate.customer_name}" already exists - linking estimate`);

      // Update customer with any new info from estimate
      const updates = {};
      if (estimate.customer_email && !existingCustomer.email) {
        updates.email = estimate.customer_email;
      }
      if (estimate.customer_phone && !existingCustomer.phone) {
        updates.phone = estimate.customer_phone;
      }
      if (estimate.property_address && !existingCustomer.street) {
        updates.street = estimate.property_address;
      }

      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Customer.update(existingCustomer.id, updates);
        console.log(`Updated customer with new info from estimate`);
      }

      // Link estimate to customer
      await base44.asServiceRole.entities.Estimate.update(estimate.id, {
        customer_id: existingCustomer.id
      });

      // Create notification for staff
      await base44.asServiceRole.entities.Notification.create({
        company_id: estimate.company_id,
        user_email: estimate.created_by,
        type: 'estimate_created',
        title: 'Estimate Linked to Existing Customer',
        message: `Estimate #${estimate.estimate_number} was automatically linked to existing customer "${estimate.customer_name}"`,
        link_url: `/customer-profile?id=${existingCustomer.id}`,
        is_read: false
      });

      return Response.json({ 
        success: true, 
        message: 'Linked to existing customer',
        customer_id: existingCustomer.id,
        updated_fields: Object.keys(updates)
      });
    }

    // Create new customer
    const newCustomer = await base44.asServiceRole.entities.Customer.create({
      company_id: estimate.company_id,
      name: estimate.customer_name,
      email: estimate.customer_email || '',
      phone: estimate.customer_phone || '',
      street: estimate.property_address || '',
      source: 'estimate',
      tags: ['Auto-created from Estimate'],
      notes: `Automatically created from Estimate #${estimate.estimate_number}`
    });

    console.log(`Created customer "${estimate.customer_name}" from estimate #${estimate.estimate_number}`);

    return Response.json({ 
      success: true, 
      message: 'Customer created successfully',
      customer_id: newCustomer.id,
      customer_name: newCustomer.name
    });

  } catch (error) {
    console.error('Auto-create customer error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});