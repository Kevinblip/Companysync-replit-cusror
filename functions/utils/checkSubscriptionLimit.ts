import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Plan limits for AI features - MUST match Pricing page packages
// Basic: $59 | Business: $149 | Enterprise: $299
export const PLAN_LIMITS = {
  // Actual plans
  basic: {
    lexi: 1000,         // AI Interactions/month (from Basic plan)
    marcus: 100,
    ai_estimator: 100,
    voice_minutes: 50    // Call Minutes/month
  },
  business: {
    lexi: 5000,          // AI Interactions/month (from Business plan)
    marcus: 500,
    ai_estimator: 500,
    voice_minutes: 999999 // Unlimited
  },
  enterprise: {
    lexi: 999999,        // Unlimited
    marcus: 999999,
    ai_estimator: 999999,
    voice_minutes: 999999
  },
  // Trial gets Basic-level limits
  trial: {
    lexi: 1000,
    marcus: 100,
    ai_estimator: 100,
    voice_minutes: 50
  },
  // Legacy aliases
  freelance: { lexi: 1000, marcus: 100, ai_estimator: 100, voice_minutes: 50 },
  starter: { lexi: 1000, marcus: 100, ai_estimator: 100, voice_minutes: 50 },
  professional: { lexi: 5000, marcus: 500, ai_estimator: 500, voice_minutes: 999999 },
  legacy: { lexi: 999999, marcus: 999999, ai_estimator: 999999, voice_minutes: 999999 },
  unlimited: { lexi: 999999, marcus: 999999, ai_estimator: 999999, voice_minutes: 999999 }
};

export async function checkSubscriptionLimit(base44, companyId, feature) {
  try {
    // 1. Get Company Plan
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    if (!companies || companies.length === 0) return { allowed: false, error: "Company not found" };
    
    const company = companies[0];
    const planName = (company.subscription_plan || 'trial').toLowerCase();
    
    // 2. Determine Limit
    const limits = PLAN_LIMITS[planName] || PLAN_LIMITS['trial']; // Default to trial if unknown
    const limit = limits[feature] || 0;

    // 3. Check Usage for Current Month
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    
    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
      company_id: companyId,
      feature: feature,
      usage_month: currentMonth
    });

    const used = usageRecords.length > 0 ? (usageRecords[0].credits_used || 0) : 0;

    // 4. Return Result
    if (used >= limit) {
      return { 
        allowed: false, 
        current_usage: used, 
        limit: limit,
        plan: planName,
        upgrade_required: true,
        error: `Monthly limit reached for ${feature}. (${used}/${limit}). Please upgrade your plan.`
      };
    }

    return { 
      allowed: true, 
      current_usage: used, 
      limit: limit,
      plan: planName 
    };

  } catch (error) {
    console.error("Error checking limits:", error);
    // Fail safe - allow if check fails (or deny if you prefer strictness)
    return { allowed: true, error: "Limit check failed, allowing access" }; 
  }
}