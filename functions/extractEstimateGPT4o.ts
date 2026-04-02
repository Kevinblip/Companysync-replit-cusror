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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = await getCompanyId(base44, user);
    if (companyId) {
      const aiCheck = await checkAIUsage(base44, companyId);
      if (!aiCheck.allowed) {
        return Response.json({ error: aiCheck.error || 'AI limit reached', success: false }, { status: 429 });
      }
    }

    const { fileUrl, description, pricingSource, jobType } = await req.json();

    console.log('📄 Extracting from:', fileUrl);
    console.log('🎯 Job Type:', jobType || 'roofing');
    console.log('💰 Pricing Source:', pricingSource || 'xactimate');

    const openaiApiKey = Deno.env.get('Open_AI_Api_Key');
    if (!openaiApiKey) {
      return Response.json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Determine which pricing source to use
    let priceListSource = 'Xactimate';
    if (pricingSource === 'xactimate_new') {
      priceListSource = 'Xactimate_New';
    } else if (pricingSource === 'custom') {
      priceListSource = 'Custom';
    } else if (pricingSource === 'symbility') {
      priceListSource = 'Symbility';
    }

    // Fetch price list items for context
    const priceList = await base44.entities.PriceListItem.filter({ source: priceListSource }, '-created_date', 200);
    console.log(`📋 Loaded ${priceList.length} items from ${priceListSource} price list`);

    // Build price list context grouped by category
    let priceListContext = '';
    if (priceList.length > 0) {
      const categories = {};
      priceList.forEach(item => {
        const cat = item.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(`${item.code}: ${item.description} - $${item.price}/${item.unit}`);
      });

      priceListContext = Object.entries(categories)
        .map(([cat, items]) => `**${cat}:**\n${items.slice(0, 30).join('\n')}`)
        .join('\n\n');
    }

    const measurementPrompt = `You are an expert construction estimator and measurement report analyst. You specialize in extracting precise data from EagleView, Hover, GAF QuickMeasure, and similar aerial/exterior measurement reports.

**CRITICAL INSTRUCTIONS:**
1. Extract ALL measurements from this report with surgical precision
2. Extract customer info from the report header/cover page
3. ONLY extract items that are EXPLICITLY listed with measurements in the report
4. Match each measurement to actual codes from the price list below
5. Pay careful attention to units - distinguish between LF (linear feet), SQ (squares = 100 sq ft), SF (square feet), EA (each)
6. If a measurement appears in multiple places (summary vs detail), prefer the SUMMARY totals

**REPORT TYPE IDENTIFICATION & PARSING RULES:**

**EagleView Reports:**
- Look for "EagleView" logo/branding on cover page
- Key pages: "Roof Summary" page has total areas and lengths
- "Roof Length Diagram" shows ridge, hip, valley, rake, eave with colored lines
- "Pitch Diagram" shows pitch per roof plane
- "Structure Summary" breaks down by structure (main, garage, additions)
- Ridge is typically shown in RED, Hip in BLUE, Valley in GREEN, Rake in ORANGE, Eave in PURPLE
- Extract "Total Roof Footprint" and "Total Roof Area" separately
- Look for "Predominant Pitch" field
- EagleView often lists "Flashing" lengths including step flashing, wall flashing, headwall flashing
- Check for "Drip Edge" or "Eave/Rake Edge" totals
- Look for penetrations count (pipes, vents, skylights)

**Hover Reports:**
- Look for "Hover" or "HOVER" branding
- Provides full exterior: roof + siding + gutters + windows + doors
- "Roof Report" section has area by facet and linear measurements
- "Wall Report" section has siding areas per wall face
- "Openings" section lists windows and doors with sizes
- "Gutter" section shows linear footage and downspout count
- Hover reports often provide "Waste Factor" percentages
- Look for soffit and fascia measurements in separate sections
- Corner counts (inside/outside) are listed for siding

**GAF QuickMeasure Reports:**
- Look for "GAF" or "QuickMeasure" branding
- Summary page is typically page 6-8 with all totals
- "Measurement Summary" table has: Total Area, Ridge, Hip, Valley, Rake, Eave, Step Flashing
- Also check "Roof Facet Details" for per-facet breakdowns
- GAF reports include "Suggested Materials" with starter, ridge cap quantities
- Look for "Predominant Pitch" and "Number of Layers" fields
- GAF often separates "Drip Edge (Eave)" and "Drip Edge (Rake)" lengths
- Check for "Pipe Flashings" or "Penetrations" count

**AVAILABLE PRICE LIST (${priceListSource}):**
${priceListContext || 'No price list loaded - use generic descriptions'}

**COMPLETE EXTRACTION CHECKLIST:**

**1. CUSTOMER & PROPERTY INFORMATION:**
- Customer name (full name from header/cover, check "Ordered By" or "Customer" fields)
- Property address (complete with street, city, state, zip)
- Claim number (if shown, check header area)
- Insurance company (if shown)
- Date of report (if shown)
- Number of stories (if shown)

**2. ROOF MEASUREMENTS (extract ALL that appear):**
- roof_area_sq: Total roof area in SQUARES (if given in sq ft, divide by 100)
- roof_footprint_sq: Roof footprint area in squares (flat/projected area before pitch adjustment)
- ridge_lf: Ridge linear feet (highest horizontal roof line)
- hip_lf: Hip linear feet (angled lines going down from ridge to eave corner)
- valley_lf: Valley linear feet (inward angled lines where two planes meet)
- rake_lf: Rake/Gable edge linear feet (sloped edges on gable ends)
- eave_lf: Eave linear feet (horizontal lower edges of roof)
- drip_edge_lf: Total drip edge linear feet (if listed separately; otherwise eave_lf + rake_lf)
- step_flashing_lf: Step flashing linear feet (where roof meets a vertical wall going upslope)
- headwall_flashing_lf: Headwall/wall flashing linear feet (where roof meets wall horizontally)
- starter_strip_lf: Starter strip linear feet (typically equals eave_lf + rake_lf, or listed separately)
- ice_water_shield_lf: Ice & water shield linear feet (usually along eaves, valleys, and penetrations)
- pipe_boots_ea: Number of pipe boot/penetration flashings (pipe vents, plumbing vents)
- skylights_ea: Number of skylights
- chimney_ea: Number of chimneys
- roof_pitch: Dominant/predominant pitch (e.g., "6/12", "11/12")
- number_of_layers: Number of existing roofing layers (for tear-off)
- number_of_facets: Number of roof planes/facets
- roof_type: Detected roof type (gable, hip, dutch_hip, mansard, gambrel, flat, complex)
- waste_factor_pct: Waste factor percentage if listed

**3. SIDING MEASUREMENTS (if present):**
- siding_area_sq: Total siding area in squares
- siding_area_sf: Total siding area in square feet
- outside_corners_ea: Number of outside corners
- inside_corners_ea: Number of inside corners
- corners_lf: Corner trim total linear feet
- j_channel_lf: J-channel linear feet (around windows/doors/transitions)
- starter_strip_siding_lf: Siding starter strip linear feet
- soffit_area_sf: Soffit area in square feet
- fascia_lf: Fascia linear feet
- frieze_board_lf: Frieze board linear feet

**4. GUTTER MEASUREMENTS (if present):**
- gutter_lf: Gutter linear feet
- downspout_lf: Downspout linear feet (if given in LF)
- downspout_ea: Number of downspouts (if given as count)
- gutter_corners_ea: Number of gutter corner pieces (inside + outside miters)
- gutter_end_caps_ea: Number of end caps
- splash_blocks_ea: Number of splash blocks

**5. OPENINGS & OTHER (if present):**
- windows_ea: Total number of windows
- window_details: Array of window sizes if listed (e.g., [{size: "36x48", count: 4}])
- doors_ea: Number of doors
- garage_doors_ea: Number of garage doors
- vents_ea: Number of roof vents (box vents, turbines, ridge vents)
- ridge_vent_lf: Ridge vent linear feet (if separate from ridge)

**IMPORTANT RULES:**
- DO NOT fabricate or estimate any measurement not explicitly shown in the report
- DO NOT round measurements - preserve the exact values from the report
- For multi-page reports, cross-reference summary totals with detail pages; prefer summary totals
- For GAF reports, the "Measurement Summary" table on the summary page has the authoritative totals
- For EagleView reports, the "Roof Summary" or "Structure Summary" has authoritative totals
- For Hover reports, section summaries have authoritative totals
- If the report shows BOTH "Roof Footprint Area" and "Total Roof Area" (pitch-adjusted), extract BOTH
- If drip edge is not listed separately, do NOT calculate it - leave drip_edge_lf as 0
- If starter strip is not listed separately, do NOT calculate it - leave starter_strip_lf as 0
- Match measurements to price list codes when possible
- If no price list code matches, use descriptive names with appropriate unit

Return EXACTLY this JSON structure:
{
  "success": true,
  "customer_name": "John Smith",
  "property_address": "123 Main St, Cleveland, OH 44120",
  "claim_number": "",
  "insurance_company": "",
  "report_date": "",
  "roof_pitch": "11/12",
  "report_type": "eagleview|hover|gaf_quickmeasure|generic",
  "number_of_stories": 2,
  "measurements": {
    "roof_area_sq": 12.79,
    "roof_footprint_sq": 10.5,
    "ridge_lf": 59,
    "hip_lf": 6,
    "valley_lf": 0,
    "rake_lf": 160,
    "eave_lf": 139,
    "drip_edge_lf": 0,
    "step_flashing_lf": 78,
    "headwall_flashing_lf": 0,
    "starter_strip_lf": 0,
    "ice_water_shield_lf": 0,
    "pipe_boots_ea": 3,
    "skylights_ea": 0,
    "chimney_ea": 0,
    "number_of_layers": 1,
    "number_of_facets": 4,
    "roof_type": "gable",
    "waste_factor_pct": 0,
    "siding_area_sq": 0,
    "soffit_area_sf": 0,
    "fascia_lf": 0,
    "gutter_lf": 0,
    "downspout_ea": 0,
    "windows_ea": 0,
    "doors_ea": 0,
    "ridge_vent_lf": 0
  },
  "line_items": [
    {
      "code": "RFG SSSQ",
      "description": "Shingles - architectural",
      "quantity": 12.79,
      "unit": "SQ",
      "category": "Roofing"
    }
  ]
}`;

    console.log('🤖 Calling OpenAI GPT-4o Vision...');

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { 
                url: fileUrl,
                detail: 'high'
              }
            },
            {
              type: 'text',
              text: measurementPrompt
            }
          ]
        }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 4096
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('❌ OpenAI error:', errorText);
      return Response.json({ 
        success: false, 
        error: `OpenAI API error: ${aiResponse.status}` 
      }, { status: 500 });
    }

    const aiResult = await aiResponse.json();
    const resultText = aiResult.choices[0].message.content;

    console.log('✅ GPT-4o response:', resultText.substring(0, 500));

    let extracted;
    try {
      extracted = JSON.parse(resultText);
      console.log('👤 Customer Name:', extracted.customer_name);
      console.log('📍 Property Address:', extracted.property_address);
      console.log('📊 Line Items:', extracted.line_items?.length || 0);
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError);
      return Response.json({ 
        success: false, 
        error: 'Failed to parse AI response: ' + parseError.message 
      }, { status: 500 });
    }

    if (companyId) {
      await incrementAIUsage(base44, companyId);
    }

    return Response.json({
      success: true,
      customer_name: extracted.customer_name || "",
      property_address: extracted.property_address || "",
      claim_number: extracted.claim_number || "",
      insurance_company: extracted.insurance_company || "",
      report_date: extracted.report_date || "",
      roof_pitch: extracted.roof_pitch || null,
      report_type: extracted.report_type || "unknown",
      number_of_stories: extracted.number_of_stories || null,
      measurements: extracted.measurements || {},
      line_items: extracted.line_items || []
    });

  } catch (error) {
    console.error('💥 Error:', error);
    return Response.json({ 
      success: false, 
      error: error.message
    }, { status: 500 });
  }
});