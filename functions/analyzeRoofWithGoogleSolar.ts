import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { latitude, longitude, address } = await req.json();

    if (!latitude || !longitude) {
      return Response.json({ 
        success: false, 
        error: 'Latitude and longitude are required' 
      }, { status: 400 });
    }

    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!googleApiKey) {
      return Response.json({ 
        success: false, 
        error: 'Google Maps API key not configured' 
      }, { status: 500 });
    }

    console.log(`🛰️ Analyzing roof at: ${latitude}, ${longitude}`);
    console.log(`📍 Address: ${address}`);

    // Call Google Solar API
    const solarApiUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}&key=${googleApiKey}`;
    
    console.log('🌐 Calling Google Solar API...');
    
    const response = await fetch(solarApiUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Google Solar API error:', errorText);
      return Response.json({ 
        success: false, 
        error: `Google Solar API error: ${response.status}`,
        details: errorText
      }, { status: 500 });
    }

    const solarData = await response.json();
    
    console.log('✅ Got Solar API response:', JSON.stringify(solarData, null, 2));

    // Extract roof data
    const roofSegments = solarData.solarPotential?.roofSegmentStats || [];
    
    // Calculate total roof area in square feet
    let totalAreaSqFt = 0;
    roofSegments.forEach(segment => {
      totalAreaSqFt += segment.stats?.areaMeters2 * 10.764 || 0; // Convert m² to ft²
    });

    // Convert to roofing squares (1 square = 100 sq ft)
    const roofAreaSquares = Math.round((totalAreaSqFt / 100) * 100) / 100;

    // Get predominant pitch (convert degrees to X/12 format)
    const pitchDegrees = solarData.solarPotential?.maxArrayPanelsCount || 0;
    let pitchStr = "7/12"; // Default
    
    // Estimate linear measurements (approximations based on roof area)
    // These are rough estimates - ideally we'd calculate from actual geometry
    const sqrtArea = Math.sqrt(totalAreaSqFt);
    const ridgeLf = Math.round(sqrtArea * 0.8);
    const hipLf = 0; // Would need detailed geometry
    const valleyLf = Math.round(sqrtArea * 0.3);
    const rakeLf = Math.round(sqrtArea * 1.8);
    const eaveLf = Math.round(sqrtArea * 2.2);
    const stepFlashingLf = Math.round(sqrtArea * 0.6);

    console.log('📊 Calculated measurements:');
    console.log(`  - Roof Area: ${roofAreaSquares} SQ (${totalAreaSqFt} sq ft)`);
    console.log(`  - Ridge: ${ridgeLf} LF`);
    console.log(`  - Valley: ${valleyLf} LF`);
    console.log(`  - Rake: ${rakeLf} LF`);
    console.log(`  - Eave: ${eaveLf} LF`);

    return Response.json({
      success: true,
      roof_area_sq: roofAreaSquares,
      roof_area_sqft: totalAreaSqFt,
      ridge_lf: ridgeLf,
      hip_lf: hipLf,
      valley_lf: valleyLf,
      rake_lf: rakeLf,
      eave_lf: eaveLf,
      step_flashing_lf: stepFlashingLf,
      apron_flashing_lf: 0,
      pitch: pitchStr,
      raw_solar_data: solarData // Include full data for debugging
    });

  } catch (error) {
    console.error('💥 Error:', error);
    return Response.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});