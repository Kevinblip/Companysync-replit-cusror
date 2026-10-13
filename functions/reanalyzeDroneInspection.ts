import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { inspectionId } = await req.json();

    // Fetch the inspection
    const inspections = await base44.entities.DroneInspection.filter({ id: inspectionId });
    if (inspections.length === 0) {
      return Response.json({ error: 'Inspection not found' }, { status: 404 });
    }

    const inspection = inspections[0];
    const photos = inspection.photos || [];

    console.log(`🔄 Re-analyzing ${photos.length} photos for inspection ${inspection.inspection_number}`);

    // Fetch reference photos for better accuracy
    let referenceUrls = [];
    try {
      const referencePhotos = await base44.entities.DamageReferencePhoto.filter({ is_active: true });
      // Filter out unsupported file types (WEBP/HEIC) from references to prevent LLM errors
      referenceUrls = referencePhotos
        .map(ref => ref.photo_url)
        .filter(url => {
          const lower = url.toLowerCase();
          return !lower.endsWith('.webp') && !lower.endsWith('.heic');
        });
    } catch (err) {
      console.log('No reference photos available:', err.message);
    }

    const updatedPhotos = [];
    let hailDetected = false;
    let windDetected = false;

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      
      console.log(`Analyzing photo ${i + 1}/${photos.length}: ${photo.roof_section}`);

      // Build analysis prompt based on photo type
      let analysisPrompt = "";

      if (photo.photo_type === 'elevation_wide') {
        analysisPrompt = `You are analyzing a WIDE-ANGLE ELEVATION photo to detect damage on SIDING, GUTTERS, and other exterior components (NOT roof).

**OBJECTIVE:** Detect storm damage on NON-ROOF components.

**LOOK FOR:**
1. Siding damage (hail dents, cracks, holes)
2. Gutter damage (dents, sagging, crushed downspouts)
3. Soft metal hits (vents, flashing, AC units)
4. Other exterior (fence, awnings, screens)

**Return JSON:**
- Set 'hail_hits_counted' and 'wind_marks_counted' to 0 (N/A for elevations)
- List damage types in 'damage_types' array
- Provide detailed description`;
      } else if (photo.roof_section === 'General' || photo.roof_section === 'Garage' || photo.roof_section === 'Shed') {
        analysisPrompt = `You are analyzing a GENERAL OVERVIEW photo.

**Tasks:**
1. Overall condition - is roof intact?
2. Identify MAJOR visible damage only
3. Ignore small details

**Return JSON:**
- Set 'hail_hits_counted' and 'wind_marks_counted' to 0
- Describe overall condition`;
      } else {
        analysisPrompt = `You are an EXPERT INSURANCE ADJUSTER specializing in storm damage detection.

**PRIMARY MISSION: COUNT EVERY HAIL HIT YOU SEE**

**HAIL DAMAGE VISUAL SIGNATURES (COUNT ALL):**
1. ⚪ **WHITE/LIGHT CIRCULAR MARKS** - Fresh hail impacts (MOST OBVIOUS) - COUNT EACH ONE
2. ⚫ **DARK CIRCULAR SPOTS** - Granule loss from hail - COUNT EACH ONE  
3. 🔵 **EXPOSED BLACK MAT** - Asphalt showing through - COUNT AS SEVERE
4. 🟡 **RAISED CRATER RIMS** - Impact deformation - COUNT EACH
5. 🟣 **OVAL BRUISING** - Angled hail strikes - COUNT EACH

**ENHANCED COUNTING METHOD:**
- Divide photo into 4 quadrants (top-left, top-right, bottom-left, bottom-right)
- Count marks in EACH quadrant separately
- Sum all quadrants for total
- Example: "Top-left: 6, top-right: 4, bottom-left: 8, bottom-right: 5 = 23 TOTAL"

**CRITICAL RULE - NEVER UNDERCOUNT:**
- If you see ANY white circles or dark spots → Minimum count is 3
- If you see MULTIPLE clusters → Count must be 8+
- If damage is OBVIOUS across roof → Count must be 15+
- Better to overcount slightly than miss damage

**WIND DAMAGE (SEPARATE COUNT):**
- Linear creases (not circular) = wind damage
- Lifted/curled tabs = wind damage
- Missing shingles = wind damage

**SHINGLE MEASUREMENTS:**
- Measure shingle exposure (5-7 inches typical)
- Estimate width
- Type: 3-tab, dimensional, architectural

**🚨 DISCONTINUED FLAGS:**
- 3-tab shingles = likely_discontinued: TRUE
- Dimensional with 5" exposure + ~36" width = likely_discontinued: TRUE

**CRITICAL - VISUAL MARKUPS:**
For EVERY damage point, add to 'detections' array:
- {type: "hail"/"wind", box_2d: [ymin, xmin, ymax, xmax]}
- 0-1000 scale

**Return exact counts + detections + confidence score (50-100).**

**COVERAGE VERDICT (REQUIRED):**
- "covered": only storm damage (hail, wind, debris). Fill covered_items. non_covered_items = [].
- "not_covered": only pre-existing/maintenance issues. Fill non_covered_items. covered_items = [].
- "mixed": both present. Fill both arrays.
covered_items types: "Hail Impact", "Wind Damage / Crease", "Wind Uplift", "Storm Debris".
non_covered_items types: "Wear & Tear", "Normal Aging / Granule Loss", "Pre-Existing Damage", "Poor Installation", "Deferred Maintenance".
Each item needs type, confidence (0-100), and brief description.
Also rate photo_quality_flag: "excellent" (crisp, well-lit, close), "good" (decent), "fair" (blurry/distant), "poor".`;
      }

      // Check if main photo is unsupported
      if (photo.url.toLowerCase().endsWith('.webp') || photo.url.toLowerCase().endsWith('.heic')) {
        console.log(`Skipping unsupported photo format: ${photo.url}`);
        updatedPhotos.push(photo); // Keep original without changes
        continue;
      }

      const analysis = await base44.integrations.Core.InvokeLLM({
        prompt: analysisPrompt + (referenceUrls.length > 0 ? `\n\n**REFERENCE PHOTOS**: ${referenceUrls.length} example photos provided for comparison.` : ''),
        file_urls: [photo.url, ...referenceUrls],
        response_json_schema: {
          type: "object",
          properties: {
            damage_types: { type: "array", items: { type: "string" } },
            severity: { type: "string", enum: ["none", "minor", "moderate", "severe"] },
            has_hail_damage: { type: "boolean" },
            has_wind_damage: { type: "boolean" },
            hail_hits_counted: { type: "number" },
            wind_marks_counted: { type: "number" },
            description: { type: "string" },
            shingle_type: { type: "string", enum: ["3-tab", "dimensional", "architectural", "unknown"] },
            shingle_exposure_inches: { type: "number" },
            shingle_width_inches: { type: "number" },
            likely_discontinued: { type: "boolean" },
            confidence_score: { type: "number" },
            confidence_factors: { type: "array", items: { type: "string" } },
            quadrant_breakdown: { type: "string" },
            grid_analysis: { type: "string" },
            coverage_verdict: { type: "string", enum: ["covered", "mixed", "not_covered"] },
            covered_items: { type: "array", items: { type: "object", properties: { type: { type: "string" }, confidence: { type: "number" }, description: { type: "string" } } } },
            non_covered_items: { type: "array", items: { type: "object", properties: { type: { type: "string" }, confidence: { type: "number" }, description: { type: "string" } } } },
            photo_quality_flag: { type: "string", enum: ["excellent", "good", "fair", "poor"] },
            detections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  box_2d: { type: "array", items: { type: "number" } }
                }
              }
            }
          }
        }
      });

      // Generate annotated image if detections found
      let annotatedUrl = photo.annotated_url;
      if (analysis.detections && analysis.detections.length > 0) {
        try {
          console.log(`Drawing ${analysis.detections.length} annotations...`);
          
          const response = await fetch(photo.url);
          const blob = await response.blob();
          
          // Use simple drawing since we can't import annotateImage in backend
          // Instead, we'll just store the detection data and let frontend handle annotation
          // For now, keep existing annotated_url or set to null for re-generation on frontend
          
        } catch (err) {
          console.error('Annotation skipped:', err.message);
        }
      }

      if (analysis.has_hail_damage) hailDetected = true;
      if (analysis.has_wind_damage) windDetected = true;

      updatedPhotos.push({
        ...photo,
        damage_detected: (analysis.damage_types?.length || 0) > 0,
        damage_type: analysis.damage_types || [],
        severity: analysis.severity || 'none',
        ai_analysis: analysis.description || 'Analysis completed',
        hail_hits_counted: analysis.hail_hits_counted || 0,
        wind_marks_counted: analysis.wind_marks_counted || 0,
        shingle_type: analysis.shingle_type || photo.shingle_type || 'unknown',
        shingle_exposure_inches: analysis.shingle_exposure_inches || photo.shingle_exposure_inches || 0,
        shingle_width_inches: analysis.shingle_width_inches || photo.shingle_width_inches || 0,
        likely_discontinued: analysis.likely_discontinued || photo.likely_discontinued || false,
        detections: analysis.detections || [],
        photo_quality_flag: analysis.photo_quality_flag || photo.photo_quality_flag || 'good',
        photo_quality_score: { excellent: 95, good: 75, fair: 50, poor: 25 }[analysis.photo_quality_flag || 'good'] || 75,
        coverage_verdict: analysis.coverage_verdict || (((analysis.hail_hits_counted || 0) + (analysis.wind_marks_counted || 0)) > 0 ? 'covered' : 'mixed'),
        covered_items: analysis.covered_items || photo.covered_items || [],
        non_covered_items: analysis.non_covered_items || photo.non_covered_items || [],
        ai_notes: analysis.description || photo.ai_notes || ''
      });
    }

    // Recalculate section summaries
    const sectionSummaries = {};
    updatedPhotos.forEach(photo => {
      const section = photo.roof_section || 'General';
      if (!sectionSummaries[section]) {
        sectionSummaries[section] = {
          total_hail_marks: 0,
          total_wind_marks: 0,
          photo_count: 0,
          hail_per_sq: 0,
          wind_per_sq: 0
        };
      }
      sectionSummaries[section].total_hail_marks += photo.hail_hits_counted || 0;
      sectionSummaries[section].total_wind_marks += photo.wind_marks_counted || 0;
      sectionSummaries[section].photo_count += 1;
    });

    Object.keys(sectionSummaries).forEach(section => {
      const summary = sectionSummaries[section];
      if (summary.photo_count > 0) {
        summary.hail_per_sq = Math.round(summary.total_hail_marks / summary.photo_count);
        summary.wind_per_sq = Math.round(summary.total_wind_marks / summary.photo_count);
      }
    });

    // Recalculate overall condition
    const maxSeverity = updatedPhotos.reduce((max, photo) => {
      const severityLevels = { none: 0, minor: 1, moderate: 2, severe: 3 };
      const photoLevel = severityLevels[photo.severity] || 0;
      return photoLevel > max ? photoLevel : max;
    }, 0);

    const overallCondition =
      maxSeverity === 0 ? 'excellent' :
      maxSeverity === 1 ? 'good' :
      maxSeverity === 2 ? 'fair' : 'poor';

    const discontinuedDetected = updatedPhotos.some(p => p.likely_discontinued);

    // Update inspection
    await base44.entities.DroneInspection.update(inspectionId, {
      photos: updatedPhotos,
      section_summaries: sectionSummaries,
      overall_condition: overallCondition,
      hail_damage_detected: hailDetected,
      wind_damage_detected: windDetected,
      material_matching_flag: discontinuedDetected,
      status: 'analyzed'
    });

    console.log('✅ Reanalysis complete');

    return Response.json({
      success: true,
      photos_analyzed: updatedPhotos.length,
      hail_detected: hailDetected,
      wind_detected: windDetected,
      overall_condition: overallCondition,
      discontinued_materials: discontinuedDetected
    });

  } catch (error) {
    console.error('Reanalysis error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});