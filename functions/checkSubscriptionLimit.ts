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
    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id
    });

    if (usageRecords.length === 0) {
      return Response.json({
        allowed: false,
        error: 'No subscription found for this company',
        remaining: 0
      }, { status: 403 });
    }

    const usage = usageRecords[0];
    let allowed = false;
    let remaining = 0;

    // Check limits based on feature type
    switch (feature_type) {
      case 'ai_interaction':
        if (usage.plan_name === 'unlimited') {
          allowed = true;
          remaining = -1; // Unlimited
        } else {
          const available = (usage.ai_limit - usage.ai_used) + (usage.ai_credits_purchased || 0);
          allowed = available >= amount;
          remaining = Math.max(0, available - amount);
        }
        break;

      case 'sms':
        if (usage.plan_name === 'unlimited') {
          allowed = true;
          remaining = -1; // Unlimited
        } else {
          const available = (usage.sms_limit - usage.sms_used) + (usage.sms_credits_purchased || 0);
          allowed = available >= amount;
          remaining = Math.max(0, available - amount);
        }
        break;

      case 'call_minute':
        if (usage.plan_name === 'unlimited') {
          allowed = true;
          remaining = -1; // Unlimited
        } else {
          const available = (usage.call_minutes_limit - usage.call_minutes_used) + (usage.call_credits_purchased || 0);
          allowed = available >= amount;
          remaining = Math.max(0, available - amount);
        }
        break;

      default:
        return Response.json({
          error: 'Invalid feature type'
        }, { status: 400 });
    }

    return Response.json({
      allowed,
      remaining,
      plan: usage.plan_name,
      feature_type
    });

  } catch (error) {
    console.error('Error checking subscription limit:', error);
    return Response.json({ 
      error: error.message,
      allowed: false 
    }, { status: 500 });
  }
});