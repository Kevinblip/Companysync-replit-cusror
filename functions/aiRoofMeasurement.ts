import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const debugLogs = [];
  
  try {
    debugLogs.push('Function started');
    
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    debugLogs.push(`User authenticated: ${user.email}`);

    const { latitude, longitude, address } = await req.json();

    if (!latitude || !longitude) {
      return Response.json({ success: false, error: 'Latitude and longitude are required' }, { status: 400 });
    }

    debugLogs.push(`Analyzing coordinates: ${address || ''} (${latitude}, ${longitude})`);

    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!googleApiKey) {
      return Response.json({ 
        success: false, 
        error: 'Google Maps API key not configured. Please add GOOGLE_MAPS_API_KEY in Settings → Secrets.',
        debug_logs: debugLogs
      }, { status: 500 });
    }

    const solarApiUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}&requiredQuality=HIGH&key=${googleApiKey}`;
    debugLogs.push('Calling Google Solar API...');
    
    let solarResponse = await fetch(solarApiUrl);
    debugLogs.push(`Solar API status: ${solarResponse.status}`);

    if (!solarResponse.ok) {
      const retryUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}&requiredQuality=MEDIUM&key=${googleApiKey}`;
      debugLogs.push('Retrying with MEDIUM quality...');
      solarResponse = await fetch(retryUrl);

      if (!solarResponse.ok) {
        const fallbackUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}&key=${googleApiKey}`;
        debugLogs.push('Retrying without quality filter...');
        solarResponse = await fetch(fallbackUrl);

        if (!solarResponse.ok) {
          debugLogs.push('Solar API unavailable — returning estimated measurements');
          return Response.json({
            success: true, roof_area_sq: 6, roof_area_sqft: 600,
            ridge_lf: 20, hip_lf: 0, valley_lf: 5, rake_lf: 44, eave_lf: 54,
            step_flashing_lf: 10, pitch: '6/12',
            overall_confidence: 40,
            analysis_notes: 'Solar API unavailable. Using estimated measurements.',
            debug_logs: debugLogs, fallback_used: true
          });
        }
      }
    }

    const solarData = await solarResponse.json();
    debugLogs.push('Parsed Solar API response');

    const roofSegments = solarData.solarPotential?.roofSegmentStats || [];
    debugLogs.push(`Found ${roofSegments.length} roof segments`);

    if (roofSegments.length === 0) {
      return Response.json({
        success: true, roof_area_sq: 6, roof_area_sqft: 600,
        ridge_lf: 20, hip_lf: 0, valley_lf: 5, rake_lf: 44, eave_lf: 54,
        step_flashing_lf: 10, pitch: '6/12',
        overall_confidence: 40,
        analysis_notes: 'No roof segments detected. Using estimated measurements.',
        debug_logs: debugLogs, fallback_used: true
      });
    }

    const wholeAreaM2 = solarData.solarPotential?.wholeRoofStats?.areaMeters2 || 0;
    const wholeAreaSqFt = wholeAreaM2 * 10.764;
    let segmentSumM2 = 0;
    roofSegments.forEach((s: any) => { segmentSumM2 += s.stats?.areaMeters2 || 0; });
    const segmentSumSqFt = segmentSumM2 * 10.764;

    let totalAreaSqFt = 0, areaMethod = '';
    if (segmentSumSqFt > 0 && wholeAreaSqFt > 0) {
      const ratio = segmentSumSqFt / wholeAreaSqFt;
      if (ratio >= 0.85) { totalAreaSqFt = segmentSumSqFt; areaMethod = 'segment_sum'; }
      else if (ratio >= 0.65) { totalAreaSqFt = segmentSumSqFt * 1.05; areaMethod = 'segment_sum +5%'; }
      else { totalAreaSqFt = (segmentSumSqFt + wholeAreaSqFt) / 2; areaMethod = 'average'; }
    } else if (segmentSumSqFt > 0) { totalAreaSqFt = segmentSumSqFt; areaMethod = 'segment_sum'; }
    else if (wholeAreaSqFt > 0) { totalAreaSqFt = wholeAreaSqFt * 0.92; areaMethod = 'wholeRoofStats'; }
    else { totalAreaSqFt = 600; areaMethod = 'fallback'; }

    const roofAreaSquares = Math.round((totalAreaSqFt / 100) * 100) / 100;
    const numSegments = roofSegments.length;

    const degToX12 = (deg: number) => {
      const rise = Math.tan((deg * Math.PI) / 180) * 12;
      return `${Math.min(20, Math.max(1, Math.round(rise)))}/12`;
    };
    let predominantDeg: number | null = null, maxSegArea = 0;
    for (const seg of roofSegments as any[]) {
      const segDeg = seg.pitchDegrees ?? seg.tiltDegrees ?? null;
      const segArea = seg.stats?.areaMeters2 || 0;
      if (segDeg > 0 && segArea > maxSegArea) { maxSegArea = segArea; predominantDeg = segDeg; }
    }
    const pitchStr = predominantDeg ? degToX12(predominantDeg) : '6/12';
    const pitchRad = predominantDeg ? (predominantDeg * Math.PI / 180) : Math.atan(6/12);
    const pitchVal = predominantDeg ? Math.round(Math.tan(predominantDeg * Math.PI / 180) * 12) : 6;

    const azimuths = (roofSegments as any[])
      .map((s: any) => s.azimuthDegrees ?? null)
      .filter((a: any) => a !== null && !isNaN(a));

    const azGroups: { center: number; members: number[] }[] = [];
    for (const az of azimuths) {
      let found = false;
      for (const g of azGroups) {
        const diff = Math.abs(az - g.center);
        const wrapped = Math.min(diff, 360 - diff);
        if (wrapped < 30) { g.members.push(az); g.center = g.members.reduce((a: number, b: number) => a + b, 0) / g.members.length; found = true; break; }
      }
      if (!found) azGroups.push({ center: az, members: [az] });
    }
    const numDirections = azGroups.length;

    let roofType = 'complex';
    let typeConfidence = 55;
    if (azimuths.length < 2) {
      if (numSegments <= 2) { roofType = 'gable'; typeConfidence = 70; }
      else if (numSegments <= 4) { roofType = 'gable'; typeConfidence = 55; }
      else if (numSegments <= 6) { roofType = 'hip'; typeConfidence = 45; }
      else { roofType = 'complex'; typeConfidence = 40; }
    } else if (numSegments <= 2) { roofType = 'gable'; typeConfidence = 85; }
    else if (numDirections === 2) {
      const diff = Math.abs(azGroups[0].center - azGroups[1].center);
      const wrapped = Math.min(diff, 360 - diff);
      roofType = 'gable'; typeConfidence = wrapped > 150 ? 90 : 70;
    } else if (numDirections === 4 && numSegments >= 4 && numSegments <= 6) {
      roofType = 'hip'; typeConfidence = 85;
    } else if (numDirections >= 3 && numSegments >= 6) {
      const hasOpposingPairs = azGroups.some((g1, i) =>
        azGroups.some((g2, j) => {
          if (i >= j) return false;
          const d = Math.abs(g1.center - g2.center);
          return Math.min(d, 360 - d) > 150;
        })
      );
      if (hasOpposingPairs && numDirections >= 4) { roofType = 'cross_gable'; typeConfidence = 75; }
      else { roofType = 'complex_hip'; typeConfidence = 70; }
    } else if (numDirections === 3) { roofType = 'cross_gable'; typeConfidence = 65; }

    debugLogs.push(`Roof type: ${roofType} (confidence: ${typeConfidence}%), ${numDirections} azimuth groups`);

    const flatArea = totalAreaSqFt / (1 / Math.cos(pitchRad));
    const aspect = 1.5;
    const estWidth = Math.sqrt(flatArea / aspect);
    const estLength = flatArea / estWidth;
    const rafterLength = (estWidth / 2) / Math.cos(pitchRad);
    const hipRafterLength = Math.sqrt(Math.pow(rafterLength, 2) + Math.pow(estWidth / 2, 2));

    let ridgeLf: number, hipLf: number, valleyLf: number, rakeLf: number, eaveLf: number, stepFlashingLf: number, apronFlashingLf: number;

    switch (roofType) {
      case 'gable': {
        ridgeLf = Math.round(estLength);
        hipLf = 0; valleyLf = 0;
        rakeLf = Math.round(4 * rafterLength);
        eaveLf = Math.round(2 * estLength);
        stepFlashingLf = Math.round(estLength * 0.15);
        apronFlashingLf = 0;
        break;
      }
      case 'hip': {
        const hipRidge = Math.max(0, estLength - estWidth);
        ridgeLf = Math.round(hipRidge);
        hipLf = Math.round(4 * hipRafterLength);
        valleyLf = 0; rakeLf = 0;
        eaveLf = Math.round(2 * (estLength + estWidth));
        stepFlashingLf = Math.round(estLength * 0.12);
        apronFlashingLf = 0;
        break;
      }
      case 'cross_gable': {
        const crossWidth = estWidth * 0.6;
        const crossLength = estLength * 0.5;
        ridgeLf = Math.round(estLength + crossLength * 0.6);
        hipLf = 0;
        valleyLf = Math.round(4 * rafterLength * 0.7);
        rakeLf = Math.round(4 * rafterLength + 2 * (crossWidth / 2) / Math.cos(pitchRad));
        eaveLf = Math.round(2 * estLength + 2 * crossLength * 0.6);
        stepFlashingLf = Math.round((estLength + crossLength) * 0.2);
        apronFlashingLf = Math.round(crossWidth * 0.5);
        break;
      }
      case 'complex_hip': {
        const mainHipRidge = Math.max(0, estLength - estWidth);
        const crossFactor = (numSegments - 4) / 4;
        ridgeLf = Math.round(mainHipRidge + estLength * crossFactor * 0.3);
        hipLf = Math.round(4 * hipRafterLength + crossFactor * 2 * hipRafterLength * 0.5);
        valleyLf = Math.round(crossFactor * 2 * rafterLength * 0.8);
        rakeLf = Math.round(crossFactor * 2 * rafterLength * 0.4);
        eaveLf = Math.round(2 * (estLength + estWidth) + crossFactor * estWidth * 0.8);
        stepFlashingLf = Math.round((estLength + estWidth) * 0.15);
        apronFlashingLf = Math.round(estWidth * 0.3 * crossFactor);
        break;
      }
      default: {
        const complexity = numSegments > 4 ? Math.log2(numSegments / 4) : 0;
        const baseFactor = 1 + complexity * 0.3;
        ridgeLf = Math.round(estLength * baseFactor);
        hipLf = Math.round(numSegments > 4 ? 4 * hipRafterLength * 0.5 * baseFactor : 0);
        valleyLf = Math.round(numSegments > 6 ? 2 * rafterLength * complexity * 0.6 : 0);
        rakeLf = Math.round(2 * rafterLength * baseFactor);
        eaveLf = Math.round(2 * (estLength + estWidth * 0.5) * baseFactor);
        stepFlashingLf = Math.round(estLength * 0.2 * baseFactor);
        apronFlashingLf = Math.round(estWidth * 0.15 * complexity);
        break;
      }
    }

    const isFlatRoof = pitchStr === '0/12' || pitchStr === '1/12' || pitchStr === '2/12';
    const hasGoodData = segmentSumSqFt > 0 && roofSegments.length >= 2;
    const baseConf = hasGoodData ? 85 : 70;
    const overallConf = Math.min(98, Math.round(baseConf * (typeConfidence / 100)));

    let wastePercent = 10, wasteReason = 'Simple Gable';
    if (pitchVal >= 10 || numSegments > 10) { wastePercent = 15; wasteReason = pitchVal >= 10 ? 'Steep Pitch (10/12+)' : 'Complex Roof (>10 Facets)'; }
    else if ((pitchVal >= 7 && pitchVal <= 9) || hipLf > 0 || (valleyLf > 0 && pitchVal !== 4)) { wastePercent = 12; wasteReason = hipLf > 0 ? 'Hip/Valley Present' : 'Standard Pitch (7-9/12)'; }
    const wasteFactor = 1 + (wastePercent / 100);
    const finalOrderQty = Number((roofAreaSquares * wasteFactor).toFixed(2));

    debugLogs.push(`Area: ${totalAreaSqFt.toFixed(0)} sqft (${areaMethod}), Pitch: ${pitchStr}, Type: ${roofType}`);
    debugLogs.push(`Waste: ${wastePercent}% (${wasteReason}), Order: ${finalOrderQty} SQ`);

    return Response.json({
      success: true,
      roof_area_sq: roofAreaSquares, roof_area_sqft: totalAreaSqFt,
      ridge_lf: ridgeLf, hip_lf: hipLf, valley_lf: valleyLf,
      rake_lf: rakeLf, eave_lf: eaveLf,
      step_flashing_lf: stepFlashingLf,
      apron_flashing_lf: apronFlashingLf || 0,
      pitch: pitchStr, is_flat_roof: isFlatRoof,
      roof_type: roofType, roof_type_confidence: typeConfidence,
      final_order_quantity_sq: finalOrderQty,
      waste_percentage: wastePercent, waste_reason: wasteReason,
      num_segments: roofSegments.length, area_method: areaMethod,
      overall_confidence: overallConf,
      ridge_confidence: Math.round(overallConf * (roofType === 'gable' || roofType === 'hip' ? 1.05 : 0.92)),
      hip_confidence: Math.round(overallConf * (roofType === 'hip' ? 1.05 : roofType === 'gable' ? 1.1 : 0.85)),
      valley_confidence: Math.round(overallConf * (roofType === 'cross_gable' || roofType === 'complex_hip' ? 0.9 : 1.0)),
      rake_confidence: Math.round(overallConf * (roofType === 'gable' ? 1.05 : 0.9)),
      eave_confidence: Math.round(overallConf * 1.02),
      step_flashing_confidence: Math.round(overallConf * 0.85),
      analysis_notes: `${roofSegments.length} segments → ${roofType} roof detected. Area: ${areaMethod}. Upload EagleView/Hover reports to improve accuracy.`,
      debug_logs: debugLogs
    });

  } catch (error) {
    console.error('Error:', error);
    debugLogs.push(`ERROR: ${error.message}`);
    
    return Response.json({ 
      success: false, 
      error: error.message,
      stack: error.stack,
      debug_logs: debugLogs
    }, { status: 500 });
  }
});
