import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, plan_name = 'trial' } = await req.json();

    if (!company_id) {
      return Response.json({ error: 'Missing company_id' }, { status: 400 });
    }

    // Hardcoded plan limits as fallback (matches SubscriptionPlan entity records)
    // Basic=$59: 1000 AI, 200 SMS, 50 calls | Business=$149: 5000 AI, -1 SMS, -1 calls | Enterprise=$299: -1 all
    const FALLBACK_LIMITS = {
      basic:      { ai: 1000, sms: 200, calls: 50 },
      business:   { ai: 5000, sms: -1,  calls: -1 },
      enterprise: { ai: -1,   sms: -1,  calls: -1 },
      trial:      { ai: 1000, sms: 200, calls: 50 },
      freelance:  { ai: 1000, sms: 200, calls: 50 },
      starter:    { ai: 1000, sms: 200, calls: 50 },
      professional: { ai: 5000, sms: -1, calls: -1 },
      unlimited:  { ai: -1,   sms: -1,  calls: -1 },
      legacy:     { ai: -1,   sms: -1,  calls: -1 },
    };

    // Try to get plan details from SubscriptionPlan entity
    let aiLimit, smsLimit, callLimit;
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ plan_name });
    
    if (plans.length > 0) {
      const plan = plans[0];
      aiLimit = plan.ai_interactions_limit;
      smsLimit = plan.sms_limit;
      callLimit = plan.call_minutes_limit;
    } else {
      // Use hardcoded fallback
      const fb = FALLBACK_LIMITS[plan_name] || FALLBACK_LIMITS.trial;
      aiLimit = fb.ai;
      smsLimit = fb.sms;
      callLimit = fb.calls;
      console.log(`⚠️ Plan "${plan_name}" not found in SubscriptionPlan entity, using fallback limits`);
    }

    const today = new Date();
    const billingStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const billingEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    // Check if usage record already exists
    const existing = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id
    });

    if (existing.length > 0) {
      const record = existing[0];
      // 🔧 FIX: If plan changed or limits are stale, update the limits
      const needsUpdate = record.plan_name !== plan_name ||
                          record.ai_limit !== aiLimit ||
                          record.sms_limit !== smsLimit ||
                          record.call_minutes_limit !== callLimit;

      if (needsUpdate) {
        console.log(`🔄 Updating stale usage record for company ${company_id}: ${record.plan_name} → ${plan_name}`);
        const updated = await base44.asServiceRole.entities.SubscriptionUsage.update(record.id, {
          plan_name,
          ai_limit: aiLimit,
          sms_limit: smsLimit,
          call_minutes_limit: callLimit,
        });
        return Response.json({ success: true, usage: updated, created: false, updated: true });
      }

      return Response.json({ success: true, usage: record, created: false });
    }

    // Create new usage record
    const usage = await base44.asServiceRole.entities.SubscriptionUsage.create({
      company_id,
      plan_name,
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

    return Response.json({ success: true, usage, created: true });

  } catch (error) {
    console.error('Error initializing subscription:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});