import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId } = await req.json();

    console.log('🧪 Running AI accuracy test...');

    // Fetch verified reference photos (gold standard)
    const allReferences = await base44.entities.DamageReferencePhoto.filter({ is_active: true });
    const verifiedPhotos = allReferences.filter(r => r.is_verified && r.verified_hail_count !== undefined);

    if (verifiedPhotos.length === 0) {
      return Response.json({
        error: 'No verified reference photos found. Please mark photos as verified with ground truth counts first.'
      }, { status: 400 });
    }

    console.log(`📊 Found ${verifiedPhotos.length} verified reference photos for testing`);

    // Fetch ALL reference photos to use as context
    const contextReferences = allReferences
      .filter(r => r.photo_url)
      .map(r => r.photo_url)
      .filter(url => {
        const lower = url.toLowerCase();
        return !lower.endsWith('.webp') && !lower.endsWith('.heic');
      });

    console.log(`📚 Using ${contextReferences.length} reference photos as context`);

    // Run AI analysis on each verified photo
    const testResults = [];
    
    for (let i = 0; i < verifiedPhotos.length; i++) {
      const photo = verifiedPhotos[i];
      
      console.log(`Testing ${i + 1}/${verifiedPhotos.length}: ${photo.damage_type}`);

      const analysisPrompt = `You are an EXPERT INSURANCE ADJUSTER specializing in storm damage detection.

**PRIMARY MISSION: COUNT EVERY HAIL HIT YOU SEE**

**HAIL DAMAGE VISUAL SIGNATURES (COUNT ALL):**
1. ⚪ **WHITE/LIGHT CIRCULAR MARKS** - Fresh hail impacts - COUNT EACH ONE
2. ⚫ **DARK CIRCULAR SPOTS** - Granule loss from hail - COUNT EACH ONE  
3. 🔵 **EXPOSED BLACK MAT** - Asphalt showing through - COUNT AS SEVERE

**ENHANCED COUNTING METHOD:**
- Divide photo into 4 quadrants
- Count marks in EACH quadrant separately
- Sum all quadrants for total

**WIND DAMAGE (SEPARATE COUNT):**
- Linear creases = wind damage
- Lifted/curled tabs = wind damage
- Missing shingles = wind damage

Return exact counts + confidence score (50-100).`;

      try {
        const analysis = await base44.integrations.Core.InvokeLLM({
          prompt: analysisPrompt + `\n\n**REFERENCE PHOTOS**: ${contextReferences.length} example photos provided for comparison.`,
          file_urls: [photo.photo_url, ...contextReferences.filter(url => url !== photo.photo_url)],
          response_json_schema: {
            type: "object",
            properties: {
              hail_hits_counted: { type: "number" },
              wind_marks_counted: { type: "number" },
              confidence_score: { type: "number" }
            }
          }
        });

        // Calculate accuracy
        const hailAccuracy = photo.verified_hail_count > 0 
          ? Math.round((Math.min(analysis.hail_hits_counted, photo.verified_hail_count) / photo.verified_hail_count) * 100)
          : (analysis.hail_hits_counted === 0 ? 100 : 0);

        const windAccuracy = photo.verified_wind_count !== undefined && photo.verified_wind_count > 0
          ? Math.round((Math.min(analysis.wind_marks_counted, photo.verified_wind_count) / photo.verified_wind_count) * 100)
          : (analysis.wind_marks_counted === 0 ? 100 : 0);

        testResults.push({
          damage_type: photo.damage_type,
          description: photo.description,
          verified_hail: photo.verified_hail_count,
          ai_hail: analysis.hail_hits_counted,
          hail_accuracy: hailAccuracy,
          verified_wind: photo.verified_wind_count || 0,
          ai_wind: analysis.wind_marks_counted,
          wind_accuracy: windAccuracy,
          confidence: analysis.confidence_score,
          photo_url: photo.photo_url
        });

      } catch (error) {
        console.error(`Failed to analyze photo:`, error);
        testResults.push({
          damage_type: photo.damage_type,
          error: error.message
        });
      }
    }

    // Calculate overall metrics
    const validResults = testResults.filter(r => !r.error);
    const avgHailAccuracy = validResults.length > 0 
      ? Math.round(validResults.reduce((sum, r) => sum + r.hail_accuracy, 0) / validResults.length)
      : 0;
    const avgWindAccuracy = validResults.length > 0
      ? Math.round(validResults.reduce((sum, r) => sum + r.wind_accuracy, 0) / validResults.length)
      : 0;
    const avgConfidence = validResults.length > 0
      ? Math.round(validResults.reduce((sum, r) => sum + r.confidence, 0) / validResults.length)
      : 0;

    console.log(`✅ Test complete - Hail Accuracy: ${avgHailAccuracy}%, Wind Accuracy: ${avgWindAccuracy}%`);

    return Response.json({
      success: true,
      summary: {
        total_verified_photos: verifiedPhotos.length,
        tests_completed: validResults.length,
        tests_failed: testResults.length - validResults.length,
        avg_hail_accuracy: avgHailAccuracy,
        avg_wind_accuracy: avgWindAccuracy,
        avg_confidence: avgConfidence,
        reference_photos_used: contextReferences.length
      },
      detailed_results: testResults,
      tested_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Test error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});