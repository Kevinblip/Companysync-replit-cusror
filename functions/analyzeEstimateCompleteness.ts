
import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

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

// Helper function to extract pitch number from a string like "X/12"
const extractPitchNumber = (pitch) => {
  if (!pitch) return 0;
  const match = pitch.match(/^(\d+)\/12$/);
  return match ? parseInt(match[1], 10) : 0;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = await getCompanyId(base44, user);
    if (companyId) {
      const aiCheck = await checkAIUsage(base44, companyId);
      if (!aiCheck.allowed) {
        return Response.json({ error: aiCheck.error || 'AI limit reached', success: false }, { status: 429 });
      }
    }

    const { lineItems, jobType, roofPitch, customerInfo } = await req.json();

    // Get knowledge base articles for estimator
    const companies = await base44.entities.Company.filter({ created_by: user.email }, '-created_date', 1);
    const myCompany = companies[0];

    const knowledgeArticles = myCompany ? await base44.entities.KnowledgeBaseArticle.filter({
      company_id: myCompany.id,
      is_ai_training: true,
      is_published: true
    }, '-priority', 50) : [];

    const estimatorKnowledge = knowledgeArticles.filter(article =>
      article.ai_assistant_targets?.includes("estimator")
    );

    // Build knowledge context
    let knowledgeContext = '';
    if (estimatorKnowledge.length > 0) {
      knowledgeContext = estimatorKnowledge.map(article =>
        `**${article.title}**\n${article.content}\n`
      ).join('\n---\n');
    } else {
      // Fallback to industry standard knowledge if no custom knowledge
      knowledgeContext = `**Standard Roofing Replacement Checklist:**
1. Shingles (main roof covering) - in SQ
2. Underlayment (#30 felt or synthetic) - in SQ
3. Ice & water shield - on eaves (6ft coverage) and valleys
4. Starter strip - on all rakes and eaves
5. Drip edge - on all rakes and eaves
6. Ridge cap - on all ridges and hips
7. Valley flashing - if valleys exist
8. Step flashing - where roof meets walls
9. Tear-off/removal of old roof - in SQ
10. Ventilation (ridge vents OR box vents)
11. Pipe flashings - for plumbing vents
12. Debris removal/dumpster
13. Labor for installation

**Common Add-ons:**
- 10% waste factor for materials
- Steep roof surcharge (if pitch > 8/12)
- High roof surcharge (if 2+ stories)
- Overhead & Profit (10-20%)
- Permits

**Standard Siding Replacement:**
1. Siding material - in SQ or SF
2. House wrap/moisture barrier
3. J-channel for trim
4. Inside corners
5. Outside corners
6. Soffit material
7. Fascia
8. Removal of old siding
9. Trim work
10. Labor

**Gutter Installation:**
1. Gutter sections - in LF
2. Downspouts - per EA
3. Gutter guards/screens
4. End caps
5. Corners (inside/outside)
6. Hangers/brackets
7. Labor`;
    }

    // Current estimate summary
    const currentItems = lineItems.map(item => 
      `${item.code || 'N/A'}: ${item.description} - ${item.quantity} ${item.unit}`
    ).join('\n');

    // Analyze with LLM
    const llmResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert construction estimator. Analyze this estimate for completeness.

**Job Type:** ${jobType || 'roofing'}
**Roof Pitch:** ${roofPitch || 'unknown'}
**Property:** ${customerInfo?.property_address || 'N/A'}

**Current Line Items:**
${currentItems}

**Your Company's Knowledge Base:**
${knowledgeContext}

**Task:** Identify what's typically MISSING from this estimate based on industry standards and the knowledge base.

**Rules:**
1. Only suggest items that are STANDARD for this type of job
2. Don't suggest items that are already in the estimate (even if named slightly differently)
3. For each suggestion, explain WHY it's needed
4. Provide a typical quantity if applicable
5. Group suggestions by category (Critical, Recommended, Optional)

**Critical** = Almost always needed (e.g., underlayment if there are shingles)
**Recommended** = Usually needed but depends on specific job
**Optional** = Nice-to-have or upgrade items

Return suggestions with justification.`,
      response_json_schema: {
        type: "object",
        properties: {
          analysis_summary: {
            type: "string",
            description: "Overall assessment of estimate completeness"
          },
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                priority: {
                  type: "string",
                  enum: ["critical", "recommended", "optional"]
                },
                item_description: {
                  type: "string",
                  description: "What item to add (search-friendly description)"
                },
                reason: {
                  type: "string",
                  description: "Why this item is needed"
                },
                typical_quantity: {
                  type: ["number", "null"],
                  description: "Typical quantity for this job"
                },
                typical_unit: {
                  type: "string",
                  description: "Typical unit (SQ, LF, EA, etc.)"
                },
                calculation_note: {
                  type: "string",
                  description: "How to calculate quantity if applicable"
                }
              },
              required: ["priority", "item_description", "reason"]
            }
          },
          estimate_quality_score: {
            type: "number",
            description: "Quality score out of 100"
          }
        }
      }
    });

    let suggestions = llmResponse.suggestions || [];

    // Check for steep roof surcharge if needed (pitch > 8/12)
    if (jobType?.toLowerCase() === 'roofing' && roofPitch && extractPitchNumber(roofPitch) > 8) {
      const hasSteep = lineItems.some(item =>
        item.description?.toLowerCase().includes('steep') &&
        item.description?.toLowerCase().includes('roof')
      );
      
      if (!hasSteep) {
        suggestions.push({
          item_description: 'Steep Roof Surcharge',
          reason: `Since the roof pitch is ${roofPitch}, a surcharge for increased labor and safety measures is typically required.`,
          calculation_note: 'Lookup steep roof surcharge from your price list (Xactimate code: STEEP, SRGE)',
          typical_quantity: null,
          typical_unit: 'SQ',
          priority: 'recommended'
        });
      }
    }

    // Check for Overhead & Profit
    const hasOP = lineItems.some(item =>
      item.description?.toLowerCase().includes('overhead') &&
      item.description?.toLowerCase().includes('profit')
    );
    
    if (!hasOP) {
      // Assuming lineItems have an 'rcv' (Replacement Cost Value) property for subtotal calculation
      const subtotal = lineItems.reduce((acc, item) => acc + (item.rcv || 0), 0);
      const opAmount = subtotal * 0.21; // 10% + 10% compound = 21%
      
      suggestions.push({
        item_description: 'Overhead & Profit (10% + 10%)',
        reason: 'Including an overhead and profit margin is standard practice to cover business costs.',
        calculation_note: `10% overhead + 10% profit (21% compound) = $${opAmount.toFixed(2)}`,
        typical_quantity: 1,
        typical_unit: 'LS',
        priority: 'optional'
      });
    }

    // Update the LLM response with any additional suggestions
    llmResponse.suggestions = suggestions;

    if (companyId) {
      await incrementAIUsage(base44, companyId);
    }

    return Response.json({
      success: true,
      ...llmResponse
    });

  } catch (error) {
    console.error('💥 Analyze estimate error:', error);
    return Response.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});
