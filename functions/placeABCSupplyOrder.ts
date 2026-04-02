import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Step 3: Place an order with ABC Supply using stored OAuth token
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { estimateId, branchNumber, deliveryDate, comments } = await req.json();

    if (!estimateId) {
      return Response.json({ error: 'Missing estimateId' }, { status: 400 });
    }

    // Get user's company
    const companies = await base44.entities.Company.filter({ created_by: user.email });
    if (!companies || companies.length === 0) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    const company = companies[0];

    // Get ABC Supply integration settings
    const integrationSettings = await base44.entities.IntegrationSetting.filter({
      company_id: company.id,
      integration_name: 'ABC Supply',
      is_enabled: true
    });

    if (!integrationSettings || integrationSettings.length === 0) {
      return Response.json({ 
        error: 'ABC Supply not connected. Please connect your account first.' 
      }, { status: 400 });
    }

    const settings = integrationSettings[0];
    const accessToken = settings.config.access_token;

    // TODO: Check if token is expired and refresh if needed

    // Get the estimate
    const estimates = await base44.entities.Estimate.filter({ id: estimateId });
    if (!estimates || estimates.length === 0) {
      return Response.json({ error: 'Estimate not found' }, { status: 404 });
    }
    const estimate = estimates[0];

    // Transform estimate line items to ABC Supply order format
    const orderItems = estimate.items.map(item => ({
      product_code: item.code || '',
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || 'EA',
      // ABC Supply will price the items based on their catalog
    }));

    // Build the order payload for ABC Supply API
    const orderPayload = {
      branch_number: branchNumber || '', // User needs to specify their ABC branch
      customer_account: company.company_name,
      delivery_date: deliveryDate || new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0], // 3 days from now
      delivery_address: {
        street: estimate.property_address || company.company_address || '',
        city: '',
        state: '',
        zip: ''
      },
      items: orderItems,
      comments: comments || `Order from estimate ${estimate.estimate_number}`
    };

    // Place order with ABC Supply
    const orderResponse = await fetch('https://partners.abcsupply.com/api/orders/2/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    if (!orderResponse.ok) {
      const errorData = await orderResponse.text();
      console.error('❌ ABC Supply order failed:', errorData);
      return Response.json({ 
        error: 'Failed to place order with ABC Supply',
        details: errorData 
      }, { status: orderResponse.status });
    }

    const orderResult = await orderResponse.json();
    
    // Log the order in notes or create a record
    await base44.entities.Estimate.update(estimateId, {
      notes: (estimate.notes || '') + `\n\n🏪 ABC Supply Order Placed:\nOrder #: ${orderResult.confirmation_number}\nDate: ${new Date().toISOString()}`
    });

    console.log('✅ ABC Supply order placed:', orderResult.confirmation_number);

    return Response.json({
      success: true,
      confirmation_number: orderResult.confirmation_number,
      order_details: orderResult
    });

  } catch (error) {
    console.error('❌ ABC Supply order error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});