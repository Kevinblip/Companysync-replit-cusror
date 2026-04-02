import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    const companyId = await getCompanyId(base44, user);
    if (companyId) {
      const aiCheck = await checkAIUsage(base44, companyId);
      if (!aiCheck.allowed) {
        return Response.json({ error: aiCheck.error || 'AI limit reached' }, { status: 429 });
      }
    }

    const { photoUrls, sections, roofArea, shingleType, photoType } = await req.json();
    const apiKey = Deno.env.get('POE_API_KEY');

    if (!apiKey) {
      return Response.json({ error: 'Poe API key not configured' }, { status: 500 });
    }

    // Support single photo or multi-angle analysis
    const photos = Array.isArray(photoUrls) ? photoUrls : [photoUrls];
    const photoSections = Array.isArray(sections) ? sections : [sections];

    if (photos.length === 0) {
      return Response.json({ error: 'At least one photo required' }, { status: 400 });
    }

    console.log(`🔍 Advanced Poe API analysis: ${photos.length} photo(s), ${photoSections.join(', ')} - Mode: ${photoType || 'drone'}`);

    // SELECT PROMPT BASED ON PHOTO TYPE
    let analysisPrompt = '';

    if (photoType === 'actual_footage') {
        // CLOSE-UP MARKED DAMAGE MODE - ONLY COUNT CHALK MARKS
        analysisPrompt = `CRITICAL INSTRUCTION: These are CLOSE-UP roof photos with CHALK MARKS indicating damage locations.

    YOUR TASK:
    1. **ONLY count chalk marks** - Look for yellow, white, or other colored chalk/paint marks on shingles
    2. **Ignore granule loss, discoloration, dirt, lichen** - These are NOT damage marks
    3. **Count each distinct chalk mark as ONE damage instance**
    4. **Do NOT estimate wind speed or interpret patterns** - Just count marked areas

    For each chalk mark:
    - Determine if it's on a shingle (wind damage) or if it appears to be a hail mark location
    - If you cannot clearly determine, classify as "unknown_marked"

    OUTPUT FORMAT:
    {
    "material_type": "roof",
    "shingle_type": "3-tab/dimensional/architectural/unknown",
    "marked_damage_count": number (ONLY chalk marks),
    "chalk_marked_wind": number (marked wind damage areas),
    "chalk_marked_hail": number (marked hail damage areas),
    "confidence_score": number (80-100 for close-up clarity),
    "confidence_factors": ["close-up photo allows precise marking identification", "chalk/paint marks clearly visible"],
    "severity": "none/minor/moderate/severe",
    "ai_notes": "List each chalk mark location: top-left = 1 wind, center = 1 hail, etc."
    }`;
    } else {
        // DRONE/WIDE FOOTAGE MODE - IDENTIFY VISUAL DAMAGE PATTERNS
        analysisPrompt = `INSTRUCTIONS: You are a roof damage assessment AI analyzing DRONE or WIDE-ANGLE roof footage. For each image, perform the following steps:

**CRITICAL CORRECTION - READ THIS FIRST:**
If you see dark spots on the roof, those are MISSING SHINGLES exposing the underlayment. DO NOT analyze them as potential damage - they ARE confirmed damage.

**🏠 HOMEOWNER ADVOCACY PRINCIPLE (MANDATORY):**
You are inspecting on behalf of the homeowner. Be ACCURATE but when damage is ambiguous, lean in the homeowner's favor. Every exposed mat area = missing shingle. Every crease = wind damage. Never minimize. Never call a deteriorated roof "excellent."

**IDENTIFY:** The type of shingles. If unsure, state 'Uncertain'.
- **Organic Shingles (DISCONTINUED):** Felt/paper mat base. Shows delamination (layers peeling like cardboard), alligator cracking on exposed mat, warping/buckling, chunking. Granule loss in large patches. ALL organic shingles are discontinued — no matching possible.
- **T-Lock (DISCONTINUED):** Interlocking T-shape cutouts; no standard 3-tab vertical cutouts. ALL discontinued — AUTOMATIC full replacement per OAC 3901-1-54 matching code.
- **3-Tab Shingle:** Clean vertical cutouts every 12 inches; thin profile. Standard 5" exposure.
- **Architectural:** Staggered "dragon teeth" or layered, multi-dimensional tabs. 5 5/8" to 5 7/8" exposure.

**IF ORGANIC OR T-LOCK DETECTED:**
- Every area of exposed dark/black mat = MISSING SHINGLE TAB (count each one)
- Missing tabs are presumed WIND-CAUSED (deteriorated organic material is vulnerable to wind)
- Creased/folded organic shingles = WIND DAMAGE (organic mat does not crease on its own)
- Delamination = SEVERE condition — never call this "excellent" or "minor"
- Note differential weathering between slopes (one side worse = directional storm/sun exposure)
- Material is ALWAYS discontinued — recommend FULL REPLACEMENT

**ASSESS:** The severity of damage on a scale of 'Minor', 'Moderate', or 'Severe'.
- SEVERE: ANY exposed underlayment visible, 3+ missing shingles, extensive granule loss (10+ areas), immediate water infiltration risk, ANY organic shingle delamination, ANY T-Lock with damage
- MODERATE: 1-2 missing shingles, noticeable hail marks (5-10 areas), some displaced shingles
- MINOR: A few granule loss spots, cosmetic damage only (NEVER use for organic/T-Lock with visible deterioration)

**DETERMINE:** The likely cause of the damage (e.g., hail, wind, age, impact).
- **Missing shingles (dark rectangular voids / exposed mat)** = Wind or storm damage (especially on organic shingles)
- **Circular marks with granule loss** = Hail damage
- **Horizontal creases / folded tabs** = Wind damage
- **Delamination / chunking** = Organic material failure (accelerated by moisture + storms)
- **Widespread granule sloughing with alligator cracking** = Organic shingle end-of-life failure

**ESTIMATE:** The wind speed that may have contributed to the damage, in miles per hour (mph). Use ranges (e.g., '10-15 mph'). If wind is not a factor, state '<5 mph'.

**DETERMINE:** If the shingles are likely discontinued. Answer 'Yes', 'No', or 'Uncertain'.
- Discontinued (Imperial): 5" exposure, 36" length, 12" width
- Modern (Metric): 5 5/8" to 5 7/8" exposure, 38 3/4" to 41" length

**NOTE:** Any areas of concern, such as:
- Missing shingles exposing underlayment (dark rectangular areas)
- Granule loss (circular marks, light or dark spots)
- Displaced shingles (lifted tabs, torn edges)

**COUNTING RULES - CRITICAL:**
1. Count ONLY what is visible in THIS specific photo
2. DO NOT extrapolate to areas outside the frame
3. If you see 2 dark rectangular voids = count 2 missing shingles (not 10-15)
4. If you see 5 circular hail marks = count 5 (not 20-30)
5. **LEAN TOWARD THE HOMEOWNER** — if a dark area COULD be a missing shingle, COUNT IT
6. Dark spots = missing shingles exposing underlayment = COUNT EACH ONE
7. **For organic shingles:** Every exposed mat area is a missing tab. Every crease is wind damage. Count AGGRESSIVELY.
8. **NEVER report 0 damage on a photo showing delamination, missing tabs, or widespread granule loss**

**OUTPUT FORMAT:**
{
  "material_type": "roof",
  "shingle_type": "3-tab/dimensional/architectural/uncertain",
  "missing_shingles": number (count each dark rectangular void),
  "exposed_underlayment": boolean (are dark spots visible?),
  "displaced_shingles": number (partially damaged but attached),
  "hail_hits_counted": number (count each circular mark),
  "granule_loss_areas": number (distinct areas with granule loss),
  "confidence_score": number (50-100),
  "confidence_factors": ["array of reasons"],
  "hail_hits_per_100_sqft": number,
  "visible_area_sqft": number (estimate),
  "hail_size_estimate": "string (e.g., quarter-sized)",
  "wind_marks_counted": number (horizontal creases, lifted tabs),
  "severity": "minor/moderate/severe",
  "damage_types": ["missing_shingles", "hail", "wind"],
  "water_risk": "none/low/soon/immediate",
  "replacement_vs_repair": "string with reason",
  "likely_discontinued": boolean,
  "quadrant_breakdown": "string describing damage by area",
  "grid_analysis": "detailed explanation of counting method",
  "ai_notes": "specific observations about damage"
}

**IMPORTANT:** Focus ONLY on roof damage. Do NOT analyze the surrounding environment (trees, houses, etc.).

**REMEMBER:** Dark rectangular areas = missing shingles = underlayment exposed = count them individually.`;
    }

    // Fetch and encode all photos
    const imageParts = [];
    for (const photoUrl of photos) {
      try {
        const imageResponse = await fetch(photoUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
        const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
        
        imageParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        });
      } catch (e) {
        console.error(`Failed to fetch photo: ${photoUrl}`, e);
        return Response.json({ error: `Failed to fetch photo: ${photoUrl}` }, { status: 500 });
      }
    }

    // Build multi-angle context
    const angleContext = photos.length > 1 
      ? `\n\n**MULTI-ANGLE ANALYSIS MODE:**
You are receiving ${photos.length} photos of the same/related roof areas:\n${photoSections.map((s, i) => `- Photo ${i+1}: ${s}`).join('\n')}

**YOUR TASK:**
1. Analyze each photo independently for damage counts
2. Cross-validate patterns across photos (pattern correlation)
3. Use shadow analysis from different angles to confirm 3D damage (lifted tabs, deformation depth)
4. Increase confidence score based on multi-angle consistency
5. Flag discrepancies (e.g., "Photo 1 shows 12 hits on south slope, Photo 2 shows similar pattern on same area = confirms damage")
6. Provide separate counts per photo, then combined/validated count`
      : '';

    // Call Poe API for DAMAGE ANALYSIS
    const poeResponse = await fetch('https://api.poe.com/bot/chat', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '1.0',
        type: 'query',
        query: [{
          role: 'user',
          content: analysisPrompt,
          attachments: imageParts.map(img => ({
            url: photos[imageParts.indexOf(img)],
            content_type: img.inlineData.mimeType
          }))
        }],
        temperature: 0.15,
        skip_system_prompt: false,
        logit_bias: {},
        stop_sequences: []
      })
    });

    const poeData = await poeResponse.json();
    let analysis = {};

    if (poeData.text) {
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = poeData.text;
        const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1];
        }
        analysis = JSON.parse(jsonText);
      } catch (e) {
        console.error('Failed to parse Poe response:', e);
        console.error('Raw response:', poeData.text);
        return Response.json({ error: 'Failed to parse analysis response' }, { status: 500 });
      }
    }

    // VALIDATION - TRUST THE AI COUNT, NO ARTIFICIAL INFLATION
    let validationNotes = [];

    // Only validate if counts seem unreasonably HIGH
    if (analysis.hail_hits_counted > 50) {
      validationNotes.push('Warning: Very high hail count - verify accuracy');
    }
    if (analysis.wind_marks_counted > 20) {
      validationNotes.push('Warning: Very high wind count - verify accuracy');
    }

    // Calculate hits per 100 sqft
    if (analysis.hail_hits_counted && !analysis.hail_hits_per_100_sqft) {
      const sqft = analysis.visible_area_sqft || roofArea || 100;
      analysis.hail_hits_per_100_sqft = Math.round((analysis.hail_hits_counted / sqft) * 100 * 10) / 10;
    }

    // Adjust confidence based on validation corrections
    if (validationNotes.length > 0) {
      analysis.confidence_score = Math.max(50, (analysis.confidence_score || 70) - (validationNotes.length * 5));
      analysis.confidence_factors = analysis.confidence_factors || [];
      analysis.confidence_factors.push('System validation applied');
    }

    // Add validation notes to AI notes
    if (validationNotes.length > 0) {
      analysis.ai_notes = (analysis.ai_notes || '') + '\n[VALIDATION: ' + validationNotes.join('; ') + ']';
    }

    console.log('✅ Enhanced analysis complete - Confidence:', analysis.confidence_score, '- Hits:', analysis.hail_hits_counted);

    if (companyId) {
      await incrementAIUsage(base44, companyId);
    }

    return Response.json({
      success: true,
      analysis: {
        material_type: analysis.material_type || 'roof',
        shingle_type: analysis.shingle_type || 'unknown',
        hail_hits_counted: analysis.hail_hits_counted || 0,
        confidence_score: analysis.confidence_score || 70,
        confidence_factors: analysis.confidence_factors || ['Standard analysis'],
        visible_area_sqft: analysis.visible_area_sqft || roofArea || 100,
        hail_hits_per_100_sqft: analysis.hail_hits_per_100_sqft || 0,
        hail_size: analysis.hail_size_estimate || 'unknown',
        wind_marks_counted: analysis.wind_marks_counted || 0,
        missing_shingles: analysis.missing_shingles || 0,
        severity: analysis.severity || 'none',
        damage_types: analysis.damage_types || [],
        water_risk: analysis.water_risk || 'low',
        replacement_vs_repair: analysis.replacement_vs_repair || 'inspect',
        likely_discontinued: analysis.likely_discontinued || false,
        quadrant_breakdown: analysis.quadrant_breakdown || 'not provided',
        grid_analysis: analysis.grid_analysis || '',
        ai_notes: analysis.ai_notes || '',
        analyzed_at: new Date().toISOString(),
        model_used: 'poe-api',
        analysis_mode: photos.length > 1 ? 'multi-angle' : 'single-photo'
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});