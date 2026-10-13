import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';

// Helper for batched processing
async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const daysBack = body.daysBack || 60;
    const clearOld = body.clearOld || false;
    const nationwide = body.nationwide || false;

    // 1. OPTIMIZED CLEAR OLD (Parallelized)
    if (clearOld) {
      console.log('🧹 Clearing old storms...');
      const allStorms = await base44.asServiceRole.entities.StormEvent.list('-created_date', 3000);
      
      if (allStorms.length > 0) {
        console.log(`🗑️ Deleting ${allStorms.length} events...`);
        // Delete in batches of 20 to avoid rate limits
        await processInBatches(allStorms, 20, (storm) => 
          base44.asServiceRole.entities.StormEvent.delete(storm.id).catch(e => console.error(`Failed to delete ${storm.id}:`, e))
        );
        console.log(`✅ Deleted ${allStorms.length} old storm events`);
      }
    }

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysBack);

    console.log(`🌪️ Fetching storm data (${daysBack} days back)...`);
    console.log(`📅 Date range: ${startDate.toISOString()} to ${now.toISOString()}`);
    console.log(`🌎 Nationwide mode: ${nationwide}`);

    const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
    const userCompany = companies[0];

    let alertSettings = null;
    if (userCompany) {
      const settings = await base44.asServiceRole.entities.StormAlertSettings.filter({ company_id: userCompany.id });
      alertSettings = settings[0];
    }

    // State Detection Logic
    let serviceCenter = null;
    let serviceRadius = 50;
    let userState = null;
    let userLat = null;
    let userLon = null;
    
    const stateMap = {
      'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
      'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
      'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
      'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
      'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
      'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
      'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
      'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
      'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
      'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
    };
    
    // Determine Service Center (Priority: Settings -> Company Address -> Default)
    if (alertSettings?.service_center_location) {
      serviceCenter = alertSettings.service_center_location;
    } else if (userCompany?.city && userCompany?.state) {
      serviceCenter = `${userCompany.city}, ${userCompany.state}`;
      console.log(`ℹ️ Using company address as service center: ${serviceCenter}`);
    } else {
      serviceCenter = "Columbus, OH"; // Fallback default
      console.log(`⚠️ No location found, defaulting to: ${serviceCenter}`);
    }

    if (alertSettings?.service_radius_miles) serviceRadius = alertSettings.service_radius_miles;

    // Parse State from Service Center for IEM
    if (serviceCenter) {
      let statePart = null;
      const parts = serviceCenter.split(',').map(p => p.trim());
      if (parts.length > 1) {
        statePart = parts[parts.length - 1];
      } else {
        const words = serviceCenter.trim().split(/\s+/);
        if (words.length >= 2) statePart = words[words.length - 1];
      }
      
      if (statePart) {
        const stateUpper = statePart.toUpperCase();
        if (stateUpper.length === 2) userState = stateUpper;
        else userState = stateMap[stateUpper.toLowerCase()] || null;
      }
    }

    // Geocode Service Center
    if (serviceCenter) {
      try {
        const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(serviceCenter)}&limit=1&countrycodes=us`;
        const geoRes = await fetch(geoUrl, { headers: { 'User-Agent': 'Base44-CRM/1.0' } });
        if (geoRes.ok) {
           const geoData = await geoRes.json();
           if (geoData && geoData[0]) {
             userLat = parseFloat(geoData[0].lat);
             userLon = parseFloat(geoData[0].lon);
           }
        }
      } catch (e) {
        console.error('Geocoding failed:', e.message);
      }
    }

    let targetStates = new Set();
    
    if (nationwide) {
        console.log('🌎 Nationwide search enabled - adding all 50 states');
        const allStates = [
            'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
            'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
            'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
            'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
            'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
        ];
        allStates.forEach(s => targetStates.add(s));
    } else {
        if (userState) targetStates.add(userState);
        if (alertSettings?.service_areas?.length > 0) {
          alertSettings.service_areas.forEach(area => {
            const potentialStates = area.split(',');
            potentialStates.forEach(item => {
              const cleanItem = item.trim().toUpperCase();
              const match = cleanItem.match(/\b([A-Z]{2})\b/);
              if (match) targetStates.add(match[1]);
            });
          });
        }
        if (targetStates.size === 0) ['OH', 'TX', 'FL'].forEach(s => targetStates.add(s));
    }

    // Data Collection Arrays
    const eventsToCreate = [];
    const eventIdsSet = new Set();

    // Load existing IDs to deduplicate if not cleared (Fetch more to prevent duplicates)
    if (!clearOld) {
        // Fetch most recent 20,000 to cover extensive history
        const existing = await base44.asServiceRole.entities.StormEvent.list('-created_date', 20000);
        existing.forEach(e => eventIdsSet.add(e.event_id));
        console.log(`ℹ️ Loaded ${existing.length} existing event IDs for deduplication`);
    }

    // 2. FETCH IEM DATA (Optimized & Incremental)
    let chunksToProcess = [];

    // REFACTORED: IEM API usually prefers single state requests or specific formatting.
    // To ensure reliability and maximum data completeness, we will request state-by-state in parallel.
    // This avoids URL length limits and potential API strictness on comma-separated values.
    
    const stateList = Array.from(targetStates);
    chunksToProcess = stateList; // Process each state individually

    console.log(`🔎 Processing ${chunksToProcess.length} states in parallel (using lsr.php)...`);

    // Process in parallel (10 concurrent requests) to keep it fast but reliable
    await processInBatches(chunksToProcess, 10, async (stateCode) => {
        console.log(`📡 Fetching state: ${stateCode}`);
        const chunkEvents = [];
        
        try {
            const startStr = startDate.toISOString().split('.')[0] + 'Z';
            const endStr = now.toISOString().split('.')[0] + 'Z';
            
            // Using standard PHP endpoint which is more reliable for historical data
            // Format timestamps for lsr.php (YYYY-MM-DDTHH:MM)
            const sts = startStr.substring(0, 16);
            const ets = endStr.substring(0, 16);
            
            const iemUrl = `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${sts}&ets=${ets}&states=${stateCode}`;
            
            console.log(`🌐 Fetching: ${iemUrl}`);

            const iemResponse = await fetch(iemUrl, {
              headers: { 'User-Agent': 'Base44-CRM/1.0 (contact@base44.io)' }
            });

            if (iemResponse.ok) {
                const data = await iemResponse.json();
                const features = data.features || [];
                console.log(`   ✅ Received ${features.length} raw reports`);
                
                for (const feature of features) {
                    const props = feature.properties;
                    const coords = feature.geometry?.coordinates;
                    if (!coords || coords.length < 2) continue;

                    const longitude = coords[0];
                    const latitude = coords[1];
                    if (isNaN(latitude) || isNaN(longitude)) continue;
                    
                    const state = props.state || 'US';
                    const typeCode = props.type?.toUpperCase();
                    const remark = (props.remark || '').toUpperCase();

                    let eventType = null;
                    let severity = 'moderate';
                    let hailSize = null;
                    let windSpeed = null;
                    let isSignificant = false;

                    // --- EVENT TYPE PARSING ---
                    if (typeCode === 'H' || typeCode === 'HAIL') {
                        eventType = 'hail';
                        hailSize = props.magnitude ? parseFloat(props.magnitude) : 0.5;
                        isSignificant = true;
                        if (hailSize >= 2.75) severity = 'extreme';
                        else if (hailSize >= 2.0) severity = 'severe';
                        else if (hailSize >= 1.0) severity = 'moderate';
                        else severity = 'minor';
                    } 
                    else if (['D', 'G', 'WIND', 'TSTM WND GST', 'MARINE TSTM WIND'].includes(typeCode)) {
                        eventType = 'high_wind';
                        windSpeed = props.magnitude ? parseFloat(props.magnitude) : 40;
                        isSignificant = true;
                        if (windSpeed >= 90) severity = 'extreme';
                        else if (windSpeed >= 75) severity = 'severe';
                        else if (windSpeed >= 58) severity = 'moderate';
                        else severity = 'minor';
                    } 
                    else if (['T', 'TORNADO', 'FUNNEL CLOUD'].includes(typeCode)) {
                        eventType = 'tornado';
                        severity = typeCode === 'FUNNEL CLOUD' ? 'moderate' : 'extreme';
                        isSignificant = true;
                    }
                    else if (['SN', 'SNOW', 'BZ', 'BLIZZARD', 'IP', 'SLEET', 'ZR', 'FREEZING RAIN', 'HEAVY SNOW', 'WINTER STORM'].includes(typeCode) || remark.includes('SNOW')) {
                         eventType = 'winter_storm';
                         const snowAmt = props.magnitude ? parseFloat(props.magnitude) : 0;
                         isSignificant = true;
                         if (snowAmt > 12 || typeCode === 'BLIZZARD') severity = 'severe';
                         else if (snowAmt > 6) severity = 'moderate';
                         else severity = 'minor';
                    }
                    else if (['FF', 'FLASH FLOOD', 'FL', 'FLOOD'].includes(typeCode)) {
                        eventType = 'flood';
                        severity = typeCode === 'FLASH FLOOD' ? 'severe' : 'moderate';
                        isSignificant = true;
                    }
                    else if (['R', 'RAIN', 'HEAVY RAIN'].includes(typeCode)) {
                         eventType = 'thunderstorm';
                         const rainAmt = props.magnitude ? parseFloat(props.magnitude) : 0;
                         isSignificant = true;
                         severity = rainAmt > 2 ? 'moderate' : 'minor';
                    }

                    if (!isSignificant || !eventType) continue;

                    const eventTime = props.valid || props.utc_valid;
                    const eventId = `IEM_${state}_${eventType}_${latitude.toFixed(4)}_${longitude.toFixed(4)}_${eventTime}`;

                    if (eventIdsSet.has(eventId)) continue;
                    eventIdsSet.add(eventId);

                    let radiusMiles = 5;
                    if (eventType === 'tornado') radiusMiles = 15;
                    else if (eventType === 'hail' && hailSize >= 2) radiusMiles = 10;
                    else if (eventType === 'high_wind' && windSpeed >= 75) radiusMiles = 12;

                    let locationName = props.city || 'Unknown';
                    if (props.county) {
                        if (state === 'LA') locationName = `${props.county} Parish`;
                        else if (state === 'AK') locationName = props.county;
                        else locationName = `${props.county} County`;
                    }

                    const newEvent = {
                        event_id: eventId,
                        event_type: eventType,
                        severity: severity,
                        title: `${eventType === 'hail' ? `${hailSize}" Hail` : eventType === 'high_wind' ? `${windSpeed} mph Wind` : 'Tornado'} - ${locationName}, ${state}`,
                        description: props.remark || `${eventType} reported in ${locationName}, ${state}`,
                        affected_areas: [`${locationName}, ${state}`, `${props.city || 'Unknown'}, ${state}`],
                        start_time: new Date(eventTime).toISOString(),
                        latitude: latitude,
                        longitude: longitude,
                        radius_miles: radiusMiles,
                        hail_size_inches: hailSize,
                        wind_speed_mph: windSpeed,
                        status: 'ended',
                        source: 'Iowa Mesonet (IEM)',
                        noaa_url: 'https://mesonet.agron.iastate.edu/lsr/'
                    };

                    chunkEvents.push(newEvent);
                    // Also add to main list for stats
                    eventsToCreate.push(newEvent); 
                }

                // === INCREMENTAL SAVE (Robust) ===
                if (chunkEvents.length > 0) {
                    console.log(`💾 Saving ${chunkEvents.length} events from chunk...`);
                    // Save in sub-batches of 50
                    for (let j = 0; j < chunkEvents.length; j += 50) {
                        const saveBatch = chunkEvents.slice(j, j + 50);
                        try {
                            await base44.asServiceRole.entities.StormEvent.bulkCreate(saveBatch);
                        } catch (saveError) {
                            console.error("⚠️ Bulk save error (likely duplicates), retrying individually:", saveError.message);
                            // Fallback: Try individually
                            for (const evt of saveBatch) {
                                try {
                                    await base44.asServiceRole.entities.StormEvent.create(evt);
                                } catch (e) {
                                    // Ignore individual duplicate errors
                                }
                            }
                        }
                    }
                }
            } else {
                 console.error(`❌ IEM fetch failed: ${iemResponse.status}`);
            }
        } catch (error) {
            console.error(`❌ Chunk error:`, error.message);
        }
    });

    // 3. FETCH VISUAL CROSSING WEATHER (Timeline & Alerts) - Only if not nationwide (to save API credits) or if explicitly needed
    // Visual Crossing is limited, so we skip it for nationwide full history to avoid hitting rate limits immediately.
    let weatherApiStatus = 'skipped';
    if (!nationwide && daysBack <= 15) {
        const weatherApiKey = Deno.env.get("Base44_APIKEY_WEATHER");
        weatherApiStatus = weatherApiKey ? 'connected' : 'missing';
        console.log(`🔑 Weather API Key Status: ${weatherApiKey ? 'Connected ✅' : 'Missing ❌'}`);
        
        if (weatherApiKey && serviceCenter) {
            try {
                const vcUrl = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(serviceCenter)}/last${Math.min(daysBack, 15)}days?unitGroup=us&key=${weatherApiKey}&include=alerts,days,current&contentType=json&elements=datetime,resolvedAddress,latitude,longitude,precip,precipprob,windgust,windspeed,winddir,severerisk,conditions,description,icon,alerts`;
                
                console.log('Fetching Visual Crossing data...');
                const vcRes = await fetch(vcUrl);
                
                if (vcRes.ok) {
                    const data = await vcRes.json();
                    const alerts = data.alerts || [];
                    const lat = data.latitude || userLat;
                    const lon = data.longitude || userLon;
                    
                    // Process Alerts
                    for (const alert of alerts) {
                         const eventName = (alert.event || '').toLowerCase();
                         let eventType = null;
                         let severity = 'moderate';
                         
                         if (eventName.includes('tornado')) { eventType = 'tornado'; severity = 'severe'; }
                         else if (eventName.includes('hail')) { eventType = 'hail'; severity = 'severe'; }
                         else if (eventName.includes('wind')) { eventType = 'high_wind'; severity = 'moderate'; }
                         else if (eventName.includes('thunderstorm') || eventName.includes('severe')) { eventType = 'thunderstorm'; severity = 'severe'; }
                         else if (eventName.includes('flood')) { eventType = 'flood'; severity = 'moderate'; }
                         else if (eventName.includes('winter') || eventName.includes('snow')) { eventType = 'winter_storm'; severity = 'moderate'; }

                         if (eventType) {
                             const eventId = `VC_ALERT_${alert.id || alert.event}_${alert.onset || alert.effective || new Date().toISOString()}`;
                             if (!eventIdsSet.has(eventId)) {
                                 eventIdsSet.add(eventId);
                                 eventsToCreate.push({
                                     event_id: eventId,
                                     event_type: eventType,
                                     severity: severity,
                                     title: alert.event,
                                     description: alert.description || alert.headline,
                                     affected_areas: [serviceCenter],
                                     start_time: alert.onset || alert.effective || new Date().toISOString(),
                                     end_time: alert.ends || alert.expires,
                                     latitude: lat,
                                     longitude: lon,
                                     radius_miles: 30, // Alerts cover larger areas
                                     status: 'active',
                                     source: 'Visual Crossing (NWS)',
                                     noaa_url: alert.link || 'https://weather.gov'
                                 });
                             }
                         }
                    }
                }
            } catch (e) {
                console.error("Visual Crossing fetch failed:", e.message);
            }
        }
    }

    // 4. BULK CREATE (FOR VC OR OTHER SOURCES)
    // Note: IEM data is now saved incrementally inside the loop
    const nonIemEvents = eventsToCreate.filter(e => e.source !== 'Iowa Mesonet (IEM)');
    if (nonIemEvents.length > 0) {
        console.log(`💾 Saving ${nonIemEvents.length} additional events...`);
        const chunkSize = 50;
        for (let i = 0; i < nonIemEvents.length; i += chunkSize) {
            const chunk = nonIemEvents.slice(i, i + chunkSize);
            await base44.asServiceRole.entities.StormEvent.bulkCreate(chunk);
        }
    }

    return Response.json({
      success: true,
      newEvents: eventsToCreate.length,
      apiKeyStatus: weatherApiStatus,
      summary: {
          total_new: eventsToCreate.length,
          by_type: {
             hail: eventsToCreate.filter(e => e.event_type === 'hail').length,
             wind: eventsToCreate.filter(e => e.event_type === 'high_wind').length,
             tornado: eventsToCreate.filter(e => e.event_type === 'tornado').length
          }
      },
      message: `Successfully processed ${eventsToCreate.length} events.`
    });

  } catch (error) {
    console.error('❌ Storm fetch error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});