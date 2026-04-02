import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { addresses, companyId } = body;

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return Response.json({ 
        error: 'Please provide an array of addresses to skip trace' 
      }, { status: 400 });
    }

    // Check usage limits
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    let usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id: companyId,
      feature: 'skip_tracing',
      usage_month: currentMonth
    });

    let usageRecord = usageRecords[0];

    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    const planLimits = {
      trial: 10,
      starter: 100,
      professional: 500,
      enterprise: 99999
    };

    const monthlyLimit = planLimits[company.subscription_plan] || 10;

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

    const remainingCredits = monthlyLimit - usageRecord.credits_used;
    
    if (remainingCredits < addresses.length) {
      return Response.json({
        error: 'Not enough skip trace credits',
        requested: addresses.length,
        available: remainingCredits,
        plan: company.subscription_plan,
        upgrade_message: `You need ${addresses.length - remainingCredits} more credits. Upgrade your plan or wait until next month.`
      }, { status: 429 });
    }

    console.log(`🔍 Bulk skip tracing ${addresses.length} addresses...`);

    const apiKey = Deno.env.get('BATCH_SKIP_TRACING_API_KEY');
    
    if (!apiKey) {
      return Response.json({ 
        error: 'Skip tracing API key not configured' 
      }, { status: 500 });
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Process addresses in batches (BatchSkipTracing usually supports bulk)
    for (const addr of addresses) {
      try {
        const skipTraceResponse = await fetch('https://api.batchskiptracing.com/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: addr.street,
            city: addr.city,
            state: addr.state,
            zip: addr.zip
          })
        });

        if (skipTraceResponse.ok) {
          const data = await skipTraceResponse.json();
          results.push({
            address: addr,
            success: true,
            data: {
              full_name: data.full_name || data.name || null,
              phone_numbers: data.phones || data.phone_numbers || [],
              emails: data.emails || [],
              property_type: data.property_type || null,
              estimated_value: data.estimated_value || null,
              owner_occupied: data.owner_occupied || null
            }
          });
          successCount++;
        } else {
          results.push({
            address: addr,
            success: false,
            error: 'API request failed'
          });
          errorCount++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error('Skip trace error for address:', addr, error);
        results.push({
          address: addr,
          success: false,
          error: error.message
        });
        errorCount++;
      }
    }

    // Update usage tracking
    await base44.asServiceRole.entities.SubscriptionUsage.update(usageRecord.id, {
      credits_used: usageRecord.credits_used + successCount,
      total_cost: (usageRecord.credits_used + successCount) * 0.20,
      last_used: new Date().toISOString()
    });

    console.log(`✅ Bulk skip trace complete: ${successCount} success, ${errorCount} errors`);

    return Response.json({
      success: true,
      results: results,
      summary: {
        total: addresses.length,
        successful: successCount,
        failed: errorCount
      },
      usage: {
        used: usageRecord.credits_used + successCount,
        limit: monthlyLimit,
        remaining: monthlyLimit - (usageRecord.credits_used + successCount),
        plan: company.subscription_plan
      }
    });

  } catch (error) {
    console.error('❌ Bulk Skip Trace Error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});