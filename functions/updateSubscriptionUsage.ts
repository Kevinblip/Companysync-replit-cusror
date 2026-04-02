import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, feature_type, amount = 1 } = await req.json();

    if (!company_id || !feature_type) {
      return Response.json({ 
        error: 'Missing company_id or feature_type' 
      }, { status: 400 });
    }

    // Get subscription usage
    let usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id
    });

    // Auto-create usage record if missing
    if (usageRecords.length === 0) {
      console.log(`⚠️ No SubscriptionUsage for company ${company_id}, auto-creating...`);
      
      // Look up the company to get the plan
      const companies = await base44.asServiceRole.entities.Company.filter({ id: company_id });
      const company = companies[0];
      const planName = company?.subscription_plan || 'trial';

      const FALLBACK_LIMITS = {
        basic:        { ai: 1000, sms: 200, calls: 50 },
        business:     { ai: 5000, sms: -1,  calls: -1 },
        enterprise:   { ai: -1,   sms: -1,  calls: -1 },
        trial:        { ai: 1000, sms: 200, calls: 50 },
        freelance:    { ai: 1000, sms: 200, calls: 50 },
        starter:      { ai: 1000, sms: 200, calls: 50 },
        professional: { ai: 5000, sms: -1,  calls: -1 },
        unlimited:    { ai: -1,   sms: -1,  calls: -1 },
        legacy:       { ai: -1,   sms: -1,  calls: -1 },
      };

      let aiLimit, smsLimit, callLimit;
      const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ plan_name: planName });
      if (plans.length > 0) {
        aiLimit = plans[0].ai_interactions_limit;
        smsLimit = plans[0].sms_limit;
        callLimit = plans[0].call_minutes_limit;
      } else {
        const fb = FALLBACK_LIMITS[planName] || FALLBACK_LIMITS.trial;
        aiLimit = fb.ai;
        smsLimit = fb.sms;
        callLimit = fb.calls;
      }

      const today = new Date();
      const billingStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
      const billingEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

      const newUsage = await base44.asServiceRole.entities.SubscriptionUsage.create({
        company_id,
        plan_name: planName,
        ai_limit: aiLimit,
        ai_used: 0,
        sms_limit: smsLimit,
        sms_used: 0,
        call_minutes_limit: callLimit,
        call_minutes_used: 0,
        ai_credits_purchased: 0,
        sms_credits_purchased: 0,
        call_credits_purchased: 0,
        billing_cycle_start: billingStart,
        billing_cycle_end: billingEnd,
        last_reset_date: new Date().toISOString()
      });

      console.log(`✅ Auto-created SubscriptionUsage for ${company_id} (plan: ${planName})`);
      usageRecords = [newUsage];
    }

    const usage = usageRecords[0];
    const updateData = {};

    // Update usage based on feature type
    switch (feature_type) {
      case 'ai_interaction':
        updateData.ai_used = usage.ai_used + amount;
        break;

      case 'sms':
        updateData.sms_used = usage.sms_used + amount;
        break;

      case 'call_minute':
        updateData.call_minutes_used = usage.call_minutes_used + amount;
        break;

      default:
        return Response.json({
          error: 'Invalid feature type'
        }, { status: 400 });
    }

    // Update the usage record
    const updated = await base44.asServiceRole.entities.SubscriptionUsage.update(
      usage.id,
      updateData
    );

    return Response.json({
      success: true,
      usage: updated
    });

  } catch (error) {
    console.error('Error updating subscription usage:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});