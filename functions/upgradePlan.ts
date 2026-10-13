import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, new_plan } = await req.json();

    if (!company_id || !new_plan) {
      return Response.json({ 
        error: 'Missing company_id or new_plan' 
      }, { status: 400 });
    }

    // Verify user has access to this company
    const company = await base44.entities.Company.filter({ id: company_id });
    if (company.length === 0) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get new plan details
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      plan_name: new_plan
    });

    if (plans.length === 0) {
      return Response.json({ error: 'Plan not found' }, { status: 404 });
    }

    const plan = plans[0];

    // Get or create usage record
    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id
    });

    if (usageRecords.length === 0) {
      // Create new record
      const today = new Date();
      const billingStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
      const billingEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

      const newUsage = await base44.asServiceRole.entities.SubscriptionUsage.create({
        company_id,
        plan_name: new_plan,
        ai_limit: plan.ai_interactions_limit,
        ai_used: 0,
        sms_limit: plan.sms_limit,
        sms_used: 0,
        call_minutes_limit: plan.call_minutes_limit,
        call_minutes_used: 0,
        ai_credits_purchased: 0,
        sms_credits_purchased: 0,
        call_credits_purchased: 0,
        billing_cycle_start: billingStart,
        billing_cycle_end: billingEnd,
        last_reset_date: new Date().toISOString()
      });

      return Response.json({
        success: true,
        usage: newUsage,
        message: `Successfully upgraded to ${new_plan} plan`
      });
    }

    // Update existing record
    const usage = usageRecords[0];
    const updated = await base44.asServiceRole.entities.SubscriptionUsage.update(
      usage.id,
      {
        plan_name: new_plan,
        ai_limit: plan.ai_interactions_limit,
        sms_limit: plan.sms_limit,
        call_minutes_limit: plan.call_minutes_limit,
        ai_used: 0,
        sms_used: 0,
        call_minutes_used: 0
      }
    );

    // Update company plan
    await base44.entities.Company.update(company_id, {
      subscription_plan: new_plan
    });

    return Response.json({
      success: true,
      usage: updated,
      message: `Successfully upgraded to ${new_plan} plan`
    });

  } catch (error) {
    console.error('Error upgrading plan:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});