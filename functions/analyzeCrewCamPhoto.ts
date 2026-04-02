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

async function callGemini(apiKey: string, systemInstruction: string, prompt: string, imageData: string, mimeType: string, jsonMode: boolean = true): Promise<any> {
  const body: any = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: imageData } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('No valid response from Gemini');
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch { /* fall through */ }
    }
    const braceMatch = rawText.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch { /* fall through */ }
    }
    console.error('Failed to parse Gemini response:', rawText.substring(0, 500));
    throw new Error('Failed to parse Gemini JSON response');
  }
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

    const { photoUrl, section } = await req.json();
    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');

    if (!apiKey) {
      return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
    }

    console.log(`Analyzing CrewCam photo with Gemini 2.5 Flash: ${section}`);

    const imageResponse = await fetch(photoUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // ═══════════════════════════════════════════════════
    // PASS 1: MATERIAL IDENTIFICATION (fast, focused)
    // ═══════════════════════════════════════════════════
    console.log('Pass 1: Identifying material type...');

    const pass1System = `You are an expert building material identifier. Your ONLY job is to identify what material is in this photo. Be precise and confident.`;

    const pass1Prompt = `Look at this photo and identify the material. Ignore any section label — trust your eyes ONLY.

CRITICAL: SHINGLE TYPE IDENTIFICATION GUIDE — read carefully before deciding.

3-TAB SHINGLES (very common, often misidentified):
- FLAT, single-layer appearance — no raised bumps or shadow lines from overlapping layers
- Uniform, evenly-spaced cutouts (notches) creating exactly 3 identical tabs per strip
- Smooth granule surface with minimal texture variation
- Bottom edge of each strip is thin and flat — NO thick laminated butt edge
- Seen from drone/wide-angle: looks like a clean, flat grid pattern
- Seen from close-up: uniform flat tabs, all same height and width
- Color is usually ONE solid tone (gray, brown, black) with minimal variation
- Common brands: CertainTeed XT25, GAF Royal Sovereign, Owens Corning Supreme

DIMENSIONAL / ARCHITECTURAL SHINGLES (also common, often confused with 3-tab):
- Have a THICK, laminated lower portion — a clearly visible raised butt edge (bump)
- Creates shadow lines and a 3D, layered appearance
- IRREGULAR tab sizes — tabs vary in width and height, NOT uniform
- Multi-tonal coloring (blended colors, streaked appearance)
- The bottom edge looks THICK due to double-laminated layer
- From drone/wide-angle: visible shadow contrast between upper and lower portions of each shingle
- From close-up: you can see the raised laminate bump near the bottom of each tab

T-LOCK SHINGLES:
- Distinctive interlocking "T" or "S" shape — no straight horizontal rows
- Older style, clearly discontinuous tab pattern

ORGANIC / FIBERGLASS OLD:
- Heavier, thicker appearance, often wavy or brittle-looking edges
- Granules may appear very coarse

If you see FLAT, UNIFORM, SAME-SIZE tabs with NO raised butt edge = 3-tab
If you see LAYERED, IRREGULAR tabs with a THICK raised lower section = dimensional/architectural
When in doubt on close-up photos: look at the bottom edge of the shingle — flat thin = 3-tab, thick raised = dimensional

Return JSON:
{
  "material_category": "roof_shingle" | "siding_vinyl" | "siding_fiber_cement" | "siding_wood" | "brick_stone" | "metal_roof" | "gutter_soffit" | "interior_ceiling" | "interior_wall" | "other",
  "shingle_subtype": "3-tab" | "dimensional" | "architectural" | "organic" | "t-lock" | "metal" | "tile" | "slate" | "none",
  "is_organic_shingle": boolean,
  "is_tlock_shingle": boolean,
  "photo_quality": "excellent" | "good" | "fair" | "poor",
  "photo_distance": "close-up" | "medium" | "wide-angle" | "drone",
  "material_confidence": number (0-100),
  "brief_description": "One sentence describing what you see AND the key visual feature that determined 3-tab vs dimensional"
}`;

    let materialId;
    try {
      materialId = await callGemini(apiKey, pass1System, pass1Prompt, base64Image, mimeType);
      console.log('Pass 1 result:', materialId.material_category, materialId.shingle_subtype);
    } catch (e) {
      console.error('Pass 1 failed, using defaults:', e);
      materialId = {
        material_category: 'roof_shingle',
        shingle_subtype: 'unknown',
        is_organic_shingle: false,
        is_tlock_shingle: false,
        photo_quality: 'good',
        photo_distance: 'medium',
        material_confidence: 50,
        brief_description: 'Unable to identify in first pass'
      };
    }

    // ═══════════════════════════════════════════════════
    // PASS 2: SPECIALIZED DAMAGE ANALYSIS + DETECTIONS
    // ═══════════════════════════════════════════════════
    console.log(`Pass 2: Specialized ${materialId.material_category} damage analysis...`);

    const materialCategory = materialId.material_category;
    let pass2System = '';
    let pass2Prompt = '';

    if (materialCategory === 'siding_vinyl' || materialCategory === 'siding_fiber_cement' || materialCategory === 'siding_wood') {
      // ─── SIDING ANALYSIS ───
      pass2System = `You are an expert storm damage inspector specializing in SIDING analysis. You inspect on behalf of the homeowner — be accurate but when ambiguous, lean toward counting damage.`;

      pass2Prompt = `Analyze this ${materialId.material_category.replace('_', ' ')} photo for storm damage.

DAMAGE TYPES TO DETECT:
- HAIL: Round/oval dents or punctures in siding panels. Mark each with type "hail".
- WIND: Creases, lifted panels, torn edges, panel separation. Mark each with type "wind".
- OTHER: Missing panels, gouges, cracks, substrate exposure. Mark with type "other".

For EACH damage point you find, provide its bounding box coordinates on a 0-1000 scale:
- box_2d: [ymin, xmin, ymax, xmax] where 0=top/left and 1000=bottom/right
- Make boxes tight around each individual damage point
- For hail dents: small boxes centered on impact
- For wind damage: wider boxes spanning the affected area

COUNTING RULES:
1. Count each distinct damage point separately
2. Fresh damage has clean edges, bright exposed material
3. Old weathering has oxidized edges, gradual fading — do NOT count
4. If substrate (plywood/foam) is visible through hole = SEVERE

Return JSON:
{
  "material_type_identified": "vinyl siding" | "fiber cement" | "wood siding",
  "hail_hits_counted": number,
  "wind_marks_counted": number,
  "missing_siding_panels": number,
  "siding_tears_gouges": number,
  "substrate_exposure": boolean,
  "damage_types": ["hail", "wind", "missing_panels", etc],
  "severity": "none" | "minor" | "moderate" | "severe",
  "water_intrusion_urgency": "none" | "monitor" | "soon" | "immediate",
  "replacement_vs_repair": "string with recommendation and reason",
  "likely_discontinued": boolean,
  "coverage_verdict": "covered" | "mixed" | "not_covered",
  "covered_items": [{"type": "string", "confidence": number (0-100), "description": "brief"}],
  "non_covered_items": [{"type": "string", "confidence": number (0-100), "description": "brief"}],
  "ai_notes": "Detailed 100+ word analysis",
  "detections": [
    {"type": "hail" | "wind" | "other", "box_2d": [ymin, xmin, ymax, xmax]}
  ]
}

COVERAGE VERDICT RULES:
- "covered": storm damage ONLY (hail impacts, wind damage, storm debris). covered_items = storm items. non_covered_items = [].
- "not_covered": ONLY pre-existing/maintenance issues. covered_items = []. non_covered_items = items.
- "mixed": BOTH storm damage AND non-covered issues. Separate them clearly.
Non-covered issue types: "Wear & Tear", "Normal Aging / Granule Loss", "Pre-Existing Damage", "Poor Installation", "Deferred Maintenance", "UV Deterioration", "Ponding / Drainage Issue".
Covered item types: "Hail Impact", "Wind Damage", "Storm Debris", "Wind Uplift", "Wind Crease", "Ice Dam".`;

    } else if (materialCategory === 'interior_ceiling' || materialCategory === 'interior_wall') {
      // ─── INTERIOR ANALYSIS ───
      pass2System = `You are an expert inspector analyzing interior damage from roof/exterior failures.`;

      pass2Prompt = `Analyze this interior photo for water damage and structural issues.

DETECTION TARGETS:
- Water stains (brown/yellow discoloration) — type "other"
- Active leaks / moisture — type "other"
- Sagging drywall/ceiling — type "wind" (structural compromise)
- Mold/mildew — type "hail" (for visual marking purposes)
- Peeling paint from moisture — type "other"

For EACH damage area, provide bounding box on 0-1000 scale.

Return JSON:
{
  "material_type_identified": "drywall ceiling" | "plaster" | "wood" | etc,
  "hail_hits_counted": 0,
  "wind_marks_counted": 0,
  "water_damage_areas": number,
  "mold_present": boolean,
  "structural_sagging": boolean,
  "damage_types": ["water_damage", "mold", etc],
  "severity": "none" | "minor" | "moderate" | "severe",
  "water_intrusion_urgency": "none" | "monitor" | "soon" | "immediate",
  "replacement_vs_repair": "recommendation",
  "likely_discontinued": false,
  "coverage_verdict": "covered" | "mixed" | "not_covered",
  "covered_items": [{"type": "string", "confidence": number (0-100), "description": "brief"}],
  "non_covered_items": [{"type": "string", "confidence": number (0-100), "description": "brief"}],
  "ai_notes": "Detailed analysis",
  "detections": [
    {"type": "hail" | "wind" | "other", "box_2d": [ymin, xmin, ymax, xmax]}
  ]
}

COVERAGE VERDICT RULES:
- "covered": damage clearly caused by storm event. covered_items = storm-related damage. non_covered_items = [].
- "not_covered": pre-existing or maintenance issues only. covered_items = []. non_covered_items = all issues found.
- "mixed": BOTH storm and non-covered issues present. Separate them.
Non-covered: "Wear & Tear", "Normal Aging", "Pre-Existing Damage", "Deferred Maintenance", "Poor Installation".
Covered: "Storm Water Intrusion", "Hail Impact", "Wind Damage", "Ice Dam", "Storm Debris Impact".`;

    } else if (materialCategory === 'gutter_soffit') {
      // ─── GUTTER/SOFFIT ANALYSIS ───
      pass2System = `You are an expert storm damage inspector specializing in gutters, soffits, and fascia.`;

      pass2Prompt = `Analyze this gutter/soffit/fascia photo for storm damage.

DETECTION TARGETS:
- Hail dents on gutter faces — type "hail"
- Crushed/bent downspouts — type "hail"
- Wind-displaced or sagging sections — type "wind"
- Torn/missing soffit panels — type "wind"
- Fascia damage — type "other"

For EACH damage point, provide bounding box on 0-1000 scale.

Return JSON:
{
  "material_type_identified": "aluminum gutter" | "vinyl soffit" | etc,
  "hail_hits_counted": number,
  "wind_marks_counted": number,
  "damage_types": [],
  "severity": "none" | "minor" | "moderate" | "severe",
  "water_intrusion_urgency": "none" | "monitor" | "soon" | "immediate",
  "replacement_vs_repair": "recommendation",
  "likely_discontinued": false,
  "coverage_verdict": "covered" | "mixed" | "not_covered",
  "covered_items": [{"type": "string", "confidence": number (0-100), "description": "brief"}],
  "non_covered_items": [{"type": "string", "confidence": number (0-100), "description": "brief"}],
  "ai_notes": "Detailed analysis",
  "detections": [
    {"type": "hail" | "wind" | "other", "box_2d": [ymin, xmin, ymax, xmax]}
  ]
}

COVERAGE VERDICT RULES:
- "covered": storm damage ONLY (hail dents, wind damage, storm debris).
- "not_covered": pre-existing or maintenance issues only.
- "mixed": BOTH storm and non-covered issues.
Non-covered: "Wear & Tear", "Oxidation / Normal Aging", "Pre-Existing Damage", "Deferred Maintenance", "Improper Installation".
Covered: "Hail Impact", "Wind Damage", "Storm Debris", "Wind Uplift".`;

    } else {
      // ─── ROOF SHINGLE ANALYSIS (DEFAULT + MOST COMMON) ───
      const isOrganic = materialId.is_organic_shingle;
      const isTLock = materialId.is_tlock_shingle;
      const shingleType = materialId.shingle_subtype || 'unknown';

      let organicContext = '';
      if (isOrganic || isTLock) {
        organicContext = `
CRITICAL: This appears to be ${isOrganic ? 'ORGANIC' : ''}${isOrganic && isTLock ? ' and ' : ''}${isTLock ? 'T-LOCK' : ''} shingles.
- These are 100% DISCONTINUED — no manufacturer makes them
- Every exposed mat area = MISSING SHINGLE TAB (count as wind damage)
- Delamination = SEVERE condition, never call this "minor"
- Creased/folded shingles = WIND DAMAGE
- ALWAYS recommend FULL REPLACEMENT
`;
      }

      pass2System = `You are an elite forensic storm damage inspector analyzing a roof photo. Material ALREADY IDENTIFIED AS: ${shingleType} shingles (${materialId.photo_distance} view). DO NOT re-classify the material — trust the identification: ${shingleType}. Use exactly "${shingleType}" when describing the shingle type in your notes and JSON fields.
You inspect on behalf of the homeowner. Be ACCURATE but when damage is ambiguous, lean toward counting it. Every mark that could be damage should be marked.
${organicContext}`;

      pass2Prompt = `Analyze this ${shingleType} roof shingle photo for hail and wind damage. This is a ${materialId.photo_distance} photo.

HAIL DAMAGE — Mark each with type "hail":
- Dark/black circular spots where granules are crushed or missing
- Light/white circular marks (fresh hail impacts)
- Oval marks with exposed asphalt mat
- Dimples or depressions in shingle surface
- Raised rims around impact points
- Draw a TIGHT box around each individual hail hit

WIND DAMAGE — Mark each with type "wind":
- Horizontal crease lines across shingles (dark lines from folding)
- Lifted/curled tab edges with visible gaps underneath
- Missing shingle tabs (exposed underlayment)
- Torn edges at nail lines
- Draw a box spanning the width of each affected shingle

OTHER DAMAGE — Mark with type "other":
- Missing entire shingles exposing underlayment
- Ridge cap damage
- Flashing displacement
- Pipe boot damage

BOUNDING BOX INSTRUCTIONS (CRITICAL FOR CHALK ANNOTATIONS):
- Coordinates use 0-1000 scale: [ymin, xmin, ymax, xmax]
- 0,0 = top-left corner; 1000,1000 = bottom-right corner
- For hail hits: Make boxes roughly square, centered on the impact mark
  Example: A hit at center of photo = [460, 460, 540, 540]
- For wind creases: Make boxes wide (spanning shingle width) but short (height of crease)
  Example: A crease across middle = [480, 200, 520, 800]
- For missing shingles: Box the entire exposed area
- Place EVERY detection as its own entry — do not group

COUNTING RULES:
1. Count ONLY what is visible in THIS photo
2. Each distinct mark = 1 count = 1 detection entry
3. If you see circles/spots = hail_hits_counted must be > 0
4. If you see horizontal dark lines = wind_marks_counted must be > 0
5. Better to overcount than undercount — the desk adjuster will verify

Return JSON:
{
  "material_type_identified": "${shingleType} shingles",
  "shingle_type": "${shingleType}",
  "is_organic_shingle": ${isOrganic},
  "is_tlock_shingle": ${isTLock},
  "hail_hits_counted": number,
  "wind_marks_counted": number,
  "missing_shingles_counted": number,
  "creased_shingles_counted": number,
  "estimated_hail_size": "pea" | "dime" | "quarter" | "golf ball" | "baseball" | "unknown",
  "wind_direction": "north" | "south" | "east" | "west" | "unknown",
  "damage_types": ["hail", "wind", "missing_shingles", etc],
  "severity": "none" | "minor" | "moderate" | "severe",
  "delamination_severity": "none" | "minor" | "moderate" | "severe",
  "granule_loss_percentage": number (0-100),
  "differential_weathering_noted": boolean,
  "likely_discontinued": boolean,
  "water_intrusion_urgency": "none" | "monitor" | "soon" | "immediate",
  "replacement_vs_repair": "detailed recommendation with reason",
  "photo_quality_flag": "excellent" | "good" | "fair" | "poor",
  "uncertainty_flags": ["array of uncertainties"],
  "coverage_verdict": "covered" | "mixed" | "not_covered",
  "covered_items": [{"type": "string", "confidence": number (0-100), "description": "1 sentence"}],
  "non_covered_items": [{"type": "string", "confidence": number (0-100), "description": "1 sentence"}],
  "ai_notes": "Detailed 100+ word analysis covering: material type, damage counts with grid method, severity justification, and recommendation",
  "detections": [
    {"type": "hail", "box_2d": [ymin, xmin, ymax, xmax]},
    {"type": "wind", "box_2d": [ymin, xmin, ymax, xmax]},
    {"type": "other", "box_2d": [ymin, xmin, ymax, xmax]}
  ]
}

COVERAGE VERDICT RULES (CRITICAL — adjusters rely on this):
- "covered" = storm-caused damage ONLY (hail impacts, wind creases/uplift, storm debris). covered_items lists each storm damage type. non_covered_items = [].
- "not_covered" = ONLY pre-existing/maintenance issues, no storm damage found. covered_items = []. non_covered_items lists each issue.
- "mixed" = BOTH storm damage AND pre-existing/maintenance issues present. Split them accurately.
NON-COVERED types: "Wear & Tear", "Normal Aging / Granule Loss", "Pre-Existing Damage", "Poor Installation", "Deferred Maintenance", "UV Deterioration", "Improper Ventilation Damage".
COVERED types: "Hail Impact", "Wind Damage / Crease", "Wind Uplift", "Storm Debris Impact", "Ice Dam", "Wind-Driven Rain".
Confidence = your certainty that THIS item is accurately categorized (0-100).`;
    }

    let analysis;
    try {
      analysis = await callGemini(apiKey, pass2System, pass2Prompt, base64Image, mimeType);
      console.log(`Pass 2 complete: ${analysis.hail_hits_counted || 0} hail, ${analysis.wind_marks_counted || 0} wind, ${analysis.detections?.length || 0} detection boxes`);
    } catch (e) {
      console.error('Pass 2 failed:', e);
      return Response.json({ error: 'Damage analysis failed: ' + (e as Error).message }, { status: 500 });
    }

    // ═══════════════════════════════════════════════════
    // VALIDATION: Ensure consistency
    // ═══════════════════════════════════════════════════

    // Merge Pass 1 material info
    analysis.is_organic_shingle = materialId.is_organic_shingle || analysis.is_organic_shingle || false;
    analysis.is_tlock_shingle = materialId.is_tlock_shingle || analysis.is_tlock_shingle || false;
    analysis.material_type_identified = analysis.material_type_identified || materialId.material_category;

    // Organic/T-Lock enforcement
    if (analysis.is_organic_shingle || analysis.is_tlock_shingle) {
      analysis.likely_discontinued = true;
      if (analysis.severity === 'none' || !analysis.severity) {
        analysis.severity = 'severe';
      }
      if (!analysis.replacement_vs_repair || analysis.replacement_vs_repair.includes('repair')) {
        analysis.replacement_vs_repair = 'FULL REPLACEMENT — Material discontinued, no matching possible per OAC 3901-1-54';
      }
    }

    // Validate detection counts match reported counts
    const detections = analysis.detections || [];
    const hailBoxes = detections.filter((d: any) => d.type === 'hail').length;
    const windBoxes = detections.filter((d: any) => d.type === 'wind').length;

    // If AI drew boxes but reported 0 counts, fix it
    if (hailBoxes > 0 && (!analysis.hail_hits_counted || analysis.hail_hits_counted === 0)) {
      analysis.hail_hits_counted = hailBoxes;
    }
    if (windBoxes > 0 && (!analysis.wind_marks_counted || analysis.wind_marks_counted === 0)) {
      analysis.wind_marks_counted = windBoxes;
    }

    // If counts > 0 but no detections, that's OK — not all damage can be precisely located
    // But ensure severity matches
    const totalDamage = (analysis.hail_hits_counted || 0) + (analysis.wind_marks_counted || 0) + (analysis.missing_shingles_counted || 0);
    if (totalDamage > 0 && (analysis.severity === 'none' || !analysis.severity)) {
      analysis.severity = totalDamage <= 3 ? 'minor' : totalDamage <= 10 ? 'moderate' : 'severe';
    }

    // Validate bounding boxes are in valid range
    analysis.detections = detections.filter((d: any) => {
      if (!d.box_2d || d.box_2d.length !== 4) return false;
      const [ymin, xmin, ymax, xmax] = d.box_2d;
      return ymin >= 0 && xmin >= 0 && ymax <= 1000 && xmax <= 1000 && ymin < ymax && xmin < xmax;
    });

    console.log('Analysis complete:', JSON.stringify({
      material: analysis.material_type_identified,
      hail: analysis.hail_hits_counted,
      wind: analysis.wind_marks_counted,
      detections: analysis.detections?.length,
      severity: analysis.severity
    }));

    if (companyId) {
      await incrementAIUsage(base44, companyId);
    }

    return Response.json({
      success: true,
      analysis: {
        material_type_identified: analysis.material_type_identified || 'unknown',
        shingle_type: analysis.shingle_type || materialId.shingle_subtype || 'unknown',
        hail_hits_counted: analysis.hail_hits_counted || 0,
        wind_marks_counted: analysis.wind_marks_counted || 0,
        missing_shingles_counted: analysis.missing_shingles_counted || 0,
        creased_shingles_counted: analysis.creased_shingles_counted || 0,
        missing_siding_panels: analysis.missing_siding_panels || 0,
        siding_tears_gouges: analysis.siding_tears_gouges || 0,
        substrate_exposure: analysis.substrate_exposure || false,
        water_intrusion_urgency: analysis.water_intrusion_urgency || 'monitor',
        estimated_hail_size: analysis.estimated_hail_size || 'unknown',
        wind_direction: analysis.wind_direction || 'unknown',
        damage_types: analysis.damage_types || [],
        severity: analysis.severity || 'none',
        is_organic_shingle: analysis.is_organic_shingle || false,
        is_tlock_shingle: analysis.is_tlock_shingle || false,
        delamination_severity: analysis.delamination_severity || 'none',
        granule_loss_percentage: analysis.granule_loss_percentage || 0,
        differential_weathering_noted: analysis.differential_weathering_noted || false,
        likely_discontinued: analysis.likely_discontinued || false,
        replacement_vs_repair: analysis.replacement_vs_repair || 'further_inspection_needed',
        water_infiltration_risk: analysis.water_infiltration_risk || 'medium',
        photo_quality_flag: analysis.photo_quality_flag || materialId.photo_quality || 'good',
        photo_quality_score: { excellent: 95, good: 75, fair: 50, poor: 25 }[analysis.photo_quality_flag || materialId.photo_quality || 'good'] || 75,
        uncertainty_flags: analysis.uncertainty_flags || [],
        coverage_verdict: analysis.coverage_verdict || (((analysis.hail_hits_counted || 0) + (analysis.wind_marks_counted || 0)) > 0 ? 'covered' : 'mixed'),
        covered_items: analysis.covered_items || [],
        non_covered_items: analysis.non_covered_items || [],
        ai_notes: analysis.ai_notes || '',
        confidence_score: materialId.material_confidence ? materialId.material_confidence / 100 : 0.8,
        analyzed_at: new Date().toISOString(),
        model_used: 'gemini-2.5-flash',
        analysis_mode: 'two-pass',
        detections: analysis.detections || []
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});