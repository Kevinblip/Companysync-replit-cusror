import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { address, city, state, zip, companyId } = body;

    if (!address || !city || !state || !zip) {
      return Response.json({ 
        error: 'Missing required fields: address, city, state, zip' 
      }, { status: 400 });
    }

    // Check usage limits for this company
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    
    let usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id: companyId,
      feature: 'skip_tracing',
      usage_month: currentMonth
    });

    let usageRecord = usageRecords[0];

    // Get company subscription plan to determine limits
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    // Define limits based on subscription plan
    const planLimits = {
      trial: 10,
      starter: 100,
      professional: 500,
      enterprise: 99999
    };

    const monthlyLimit = planLimits[company.subscription_plan] || 10;

    // Create usage record if it doesn't exist
    if (!usageRecord) {
      usageRecord = await base44.asServiceRole.entities.SubscriptionUsage.create({
        company_id: companyId,
        feature: 'skip_tracing',
        usage_month: currentMonth,
        credits_used: 0,
        credits_limit: monthlyLimit,
        cost_per_unit: 0.20,
        total_cost: 0
      });
    }

    // Check if company has reached their limit
    if (usageRecord.credits_used >= monthlyLimit) {
      return Response.json({
        error: 'Monthly skip tracing limit reached',
        limit: monthlyLimit,
        used: usageRecord.credits_used,
        plan: company.subscription_plan,
        upgrade_message: 'Upgrade your plan to get more skip traces per month'
      }, { status: 429 });
    }

    console.log('🔍 Skip tracing address:', { address, city, state, zip });

    // Call BatchSkipTracing API
    const apiKey = Deno.env.get('BATCH_SKIP_TRACING_API_KEY');
    
    if (!apiKey) {
      return Response.json({ 
        error: 'Skip tracing API key not configured. Please contact support.' 
      }, { status: 500 });
    }

    // BatchSkipTracing API endpoint
    const skipTraceUrl = 'https://api.batchskiptracing.com/v1/search';
    
    const skipTraceResponse = await fetch(skipTraceUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: address,
        city: city,
        state: state,
        zip: zip
      })
    });

    if (!skipTraceResponse.ok) {
      const errorText = await skipTraceResponse.text();
      console.error('❌ BatchSkipTracing API error:', errorText);
      return Response.json({ 
        error: 'Skip tracing service unavailable',
        details: errorText
      }, { status: skipTraceResponse.status });
    }

    const skipTraceData = await skipTraceResponse.json();

    // Update usage tracking
    await base44.asServiceRole.entities.SubscriptionUsage.update(usageRecord.id, {
      credits_used: usageRecord.credits_used + 1,
      total_cost: (usageRecord.credits_used + 1) * 0.20,
      last_used: new Date().toISOString()
    });

    console.log('✅ Skip trace successful:', skipTraceData);

    // Return formatted data
    return Response.json({
      success: true,
      data: {
        full_name: skipTraceData.full_name || skipTraceData.name || null,
        phone_numbers: skipTraceData.phones || skipTraceData.phone_numbers || [],
        emails: skipTraceData.emails || [],
        property_type: skipTraceData.property_type || null,
        estimated_value: skipTraceData.estimated_value || null,
        owner_occupied: skipTraceData.owner_occupied || null
      },
      usage: {
        used: usageRecord.credits_used + 1,
        limit: monthlyLimit,
        remaining: monthlyLimit - (usageRecord.credits_used + 1),
        plan: company.subscription_plan
      }
    });

  } catch (error) {
    console.error('❌ Skip Trace Error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});