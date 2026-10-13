import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

async function getCompanyId(base44: any, user: any): Promise<string | null> {
  try {
    if (user.company_id) return user.company_id;
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
    return staffProfiles[0]?.company_id || null;
  } catch { return null; }
}

async function checkAIUsage(base44: any, companyId: string): Promise<{ allowed: boolean; error?: string }> {
  try {
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    if (!companies[0] || companies[0].company_name === 'CompanySync') return { allowed: true };
    
    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id: companyId });
    if (usageRecords.length === 0) return { allowed: true };
    
    const usage = usageRecords[0];
    const limit = (usage.ai_limit || 0) + (usage.ai_credits_purchased || 0);
    const used = usage.ai_used || 0;
    
    if (limit > 0 && used >= limit) {
      return { allowed: false, error: 'AI interaction limit reached. Please upgrade your plan or purchase additional credits.' };
    }
    return { allowed: true };
  } catch { return { allowed: true }; }
}

async function incrementAIUsage(base44: any, companyId: string): Promise<void> {
  try {
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    if (companies[0]?.company_name === 'CompanySync') return;
    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id: companyId });
    if (usageRecords.length === 0) return;
    const usage = usageRecords[0];
    await base44.asServiceRole.entities.SubscriptionUsage.update(usage.id, { ai_used: (usage.ai_used || 0) + 1 });
  } catch (err: any) { console.warn('AI usage increment failed:', err.message); }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const usageCompanyId = await getCompanyId(base44, user);
    if (usageCompanyId) {
      const aiCheck = await checkAIUsage(base44, usageCompanyId);
      if (!aiCheck.allowed) {
        return Response.json({ error: aiCheck.error || 'AI limit reached', success: false }, { status: 429 });
      }
    }

    const { 
      type, // 'email', 'sms', 'postcard', 'letter'
      context, // 'storm_damage', 'lead_followup', 'property_import', 'general'
      recipientName,
      recipientAddress,
      companyName,
      customData // { stormDate, damageType, leadSource, etc. }
    } = await req.json();

    // Build context-specific prompt
    let prompt = `You are Marcus, an expert direct response copywriter specializing in roofing and home improvement marketing.

Generate highly persuasive ${type} copy for ${context} using proven copywriting formulas (AIDA, PAS, BAB).

CONTEXT:
- Type: ${type}
- Purpose: ${context}
- Recipient: ${recipientName || 'Homeowner'}
- Company: ${companyName || 'Our Company'}
${recipientAddress ? `- Property Address: ${recipientAddress}` : ''}
${customData ? `- Additional Context: ${JSON.stringify(customData)}` : ''}

REQUIREMENTS:
1. Use proven direct response formulas
2. Create urgency and scarcity
3. Focus on benefits, not features
4. Include a clear, compelling CTA
5. ${type === 'sms' ? 'Keep under 160 characters' : type === 'postcard' ? 'Keep concise for postcard format' : 'Make it persuasive and detailed'}
6. Reference web research on high-converting ${context} campaigns

FORMATTING:
${type === 'email' ? '- Subject line (compelling, benefit-driven)\n- Body (personalized, scannable)\n- P.S. line (restate value)' : ''}
${type === 'sms' ? '- Short, actionable message with link placeholder {LINK}' : ''}
${type === 'postcard' ? '- Headline\n- Body copy\n- CTA section' : ''}
${type === 'letter' ? '- Personalized greeting\n- Story-based opening\n- Problem-solution format\n- Strong close with CTA' : ''}

Generate the ${type} copy now:`;

    // Call LLM with internet context for latest best practices
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: prompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          copy: { type: "string" },
          subject: { type: "string" },
          headline: { type: "string" },
          cta: { type: "string" },
          tips: { type: "array", items: { type: "string" } }
        }
      }
    });

    // Save to AI Memory for future learning
    try {
      await base44.asServiceRole.entities.AIMemory.create({
        agent_name: 'Marcus',
        context_type: `marketing_${type}_${context}`,
        memory_content: JSON.stringify({
          input: { type, context, recipientName, customData },
          output: result
        }),
        relevance_score: 1.0
      });
    } catch (e) {
      console.log('Failed to save to AI Memory (non-critical):', e.message);
    }

    // 🔍 CHECK LIMITS & TRACK USAGE
    try {
      const companyId = user.company_id || (await base44.asServiceRole.entities.StaffProfile.filter({user_email: user.email}))[0]?.company_id;
      
      if (companyId) {
        // Check Limit
        const { checkSubscriptionLimit } = await import('./utils/checkSubscriptionLimit.js');
        const limitCheck = await checkSubscriptionLimit(base44, companyId, 'marcus');
        
        if (!limitCheck.allowed) {
          return Response.json({ 
            error: `Monthly limit reached for Marcus on ${limitCheck.plan} plan (${limitCheck.current_usage}/${limitCheck.limit}). Upgrade to generate more copy.` 
          }, { status: 403 });
        }

        // Track Usage
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const feature = 'marcus';
        const costPerUnit = 0.02; // Estimated cost per generation

        const existingUsage = await base44.asServiceRole.entities.SubscriptionUsage.filter({
          company_id: companyId,
          feature: feature,
          usage_month: currentMonth
        });

        if (existingUsage && existingUsage.length > 0) {
          const record = existingUsage[0];
          await base44.asServiceRole.entities.SubscriptionUsage.update(record.id, {
            credits_used: (record.credits_used || 0) + 1,
            total_cost: (record.total_cost || 0) + costPerUnit,
            last_used: new Date().toISOString()
          });
        } else {
          await base44.asServiceRole.entities.SubscriptionUsage.create({
            company_id: companyId,
            feature: feature,
            usage_month: currentMonth,
            credits_used: 1,
            credits_limit: 500, // Default limit
            cost_per_unit: costPerUnit,
            total_cost: costPerUnit,
            last_used: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      console.error('Usage/Limit Error:', err.message);
      if (err.message && err.message.includes('Monthly limit reached')) {
         return Response.json({ error: err.message }, { status: 403 });
      }
    }

    if (usageCompanyId) {
      await incrementAIUsage(base44, usageCompanyId);
    }

    return Response.json({
      success: true,
      copy: result,
      metadata: {
        type,
        context,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error generating marketing copy:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});