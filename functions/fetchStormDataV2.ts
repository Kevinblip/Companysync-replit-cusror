import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
    const nationwide = body.nationwide || false;

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysBack);

    console.log(`🌪️ Fetching storm data V2 (${daysBack} days back)...`);
    
    let targetStates = new Set<string>();
    
    const stateNameToAbbr: Record<string, string> = {
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
    
    const cityToState: Record<string, string> = {
      'cleveland': 'OH', 'columbus': 'OH', 'cincinnati': 'OH', 'akron': 'OH', 'toledo': 'OH', 'dayton': 'OH',
      'houston': 'TX', 'dallas': 'TX', 'san antonio': 'TX', 'austin': 'TX', 'fort worth': 'TX',
      'miami': 'FL', 'orlando': 'FL', 'tampa': 'FL', 'jacksonville': 'FL', 'st. petersburg': 'FL',
      'chicago': 'IL', 'detroit': 'MI', 'indianapolis': 'IN', 'pittsburgh': 'PA', 'buffalo': 'NY',
      'atlanta': 'GA', 'charlotte': 'NC', 'nashville': 'TN', 'memphis': 'TN', 'louisville': 'KY',
      'denver': 'CO', 'phoenix': 'AZ', 'los angeles': 'CA', 'new york': 'NY', 'seattle': 'WA',
      'portland': 'OR', 'minneapolis': 'MN', 'kansas city': 'MO', 'st. louis': 'MO', 'oklahoma city': 'OK',
      'tulsa': 'OK', 'omaha': 'NE', 'des moines': 'IA', 'milwaukee': 'WI', 'birmingham': 'AL',
      'new orleans': 'LA', 'raleigh': 'NC', 'richmond': 'VA', 'baltimore': 'MD', 'philadelphia': 'PA',
      'boston': 'MA', 'erie': 'PA', 'youngstown': 'OH', 'canton': 'OH', 'mansfield': 'OH', 'sandusky': 'OH'
    };
    
    function extractStateFromText(text: string): string | null {
      if (!text) return null;
      const parts = text.split(',').map(p => p.trim());
      for (const part of parts) {
        const upper = part.toUpperCase();
        if (upper.length === 2 && Object.values(stateNameToAbbr).includes(upper)) {
          return upper;
        }
        const lower = part.toLowerCase();
        if (stateNameToAbbr[lower]) {
          return stateNameToAbbr[lower];
        }
      }
      const cityLower = parts[0]?.toLowerCase();
      if (cityLower && cityToState[cityLower]) {
        return cityToState[cityLower];
      }
      return null;
    }

    if (nationwide) {
        const allStates = [
            'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
            'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
            'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
            'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
            'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
        ];
        allStates.forEach(s => targetStates.add(s));
    } else {
        let settingsLoaded = false;
        try {
            const allSettings = await base44.asServiceRole.entities.StormAlertSettings.list('-created_date', 100);
            let maxRadius = 0;
            
            for (const settings of allSettings) {
                console.log(`📋 Processing settings: center=${settings.service_center_location}, areas=${JSON.stringify(settings.service_areas)}`);
                
                if (settings.service_center_location) {
                    const centerState = extractStateFromText(settings.service_center_location);
                    if (centerState) {
                        targetStates.add(centerState);
                        console.log(`📍 Added state from service center: ${centerState}`);
                    }
                }
                
                const serviceAreas = settings.service_areas || [];
                for (const area of serviceAreas) {
                    const areaState = extractStateFromText(area);
                    if (areaState) {
                        targetStates.add(areaState);
                        console.log(`📍 Added state from service area "${area}": ${areaState}`);
                    }
                }
                
                const radiusMiles = settings.service_radius_miles || 60;
                if (radiusMiles > maxRadius) maxRadius = radiusMiles;
            }
            
            if (targetStates.size > 0) {
                settingsLoaded = true;
                if (maxRadius >= 75) {
                    const neighborStates: Record<string, string[]> = {
                        'OH': ['PA', 'WV', 'KY', 'IN', 'MI'],
                        'TX': ['OK', 'AR', 'LA', 'NM'],
                        'FL': ['GA', 'AL'],
                        'PA': ['NY', 'NJ', 'DE', 'MD', 'WV', 'OH'],
                        'NY': ['PA', 'NJ', 'CT', 'MA', 'VT'],
                        'IL': ['WI', 'IN', 'IA', 'MO', 'KY'],
                        'MI': ['OH', 'IN', 'WI'],
                        'GA': ['FL', 'AL', 'TN', 'NC', 'SC'],
                        'NC': ['SC', 'GA', 'TN', 'VA'],
                        'IN': ['OH', 'MI', 'IL', 'KY'],
                        'KY': ['OH', 'IN', 'IL', 'TN', 'VA', 'WV'],
                        'TN': ['KY', 'VA', 'NC', 'GA', 'AL', 'MS', 'AR', 'MO'],
                        'VA': ['WV', 'KY', 'TN', 'NC', 'MD', 'DC'],
                        'WV': ['OH', 'PA', 'MD', 'VA', 'KY'],
                        'AL': ['FL', 'GA', 'TN', 'MS'],
                        'MS': ['AL', 'TN', 'AR', 'LA'],
                        'AR': ['MO', 'TN', 'MS', 'LA', 'TX', 'OK'],
                        'MO': ['IA', 'IL', 'KY', 'TN', 'AR', 'OK', 'KS', 'NE'],
                        'OK': ['KS', 'MO', 'AR', 'TX', 'NM', 'CO'],
                        'LA': ['TX', 'AR', 'MS'],
                        'CO': ['WY', 'NE', 'KS', 'OK', 'NM', 'UT'],
                        'KS': ['NE', 'MO', 'OK', 'CO'],
                        'NE': ['SD', 'IA', 'MO', 'KS', 'CO', 'WY'],
                        'IA': ['MN', 'WI', 'IL', 'MO', 'NE', 'SD'],
                        'MN': ['WI', 'IA', 'SD', 'ND'],
                        'WI': ['MN', 'IA', 'IL', 'MI'],
                        'SC': ['NC', 'GA'],
                        'MD': ['PA', 'DE', 'WV', 'VA'],
                        'NJ': ['NY', 'PA', 'DE'],
                        'CT': ['NY', 'MA', 'RI'],
                        'MA': ['NY', 'CT', 'RI', 'NH', 'VT'],
                    };
                    const currentStates = Array.from(targetStates);
                    for (const st of currentStates) {
                        const neighbors = neighborStates[st] || [];
                        neighbors.forEach(n => targetStates.add(n));
                    }
                    console.log(`📍 Added neighboring states for ${maxRadius}mi radius`);
                }
            }
        } catch (err) {
            console.warn('⚠️ Could not load storm alert settings:', err.message);
        }
        
        if (!settingsLoaded || targetStates.size === 0) {
            ['OH', 'TX', 'FL'].forEach(s => targetStates.add(s));
            console.log('📍 Using default states: OH, TX, FL');
        }
    }

    const eventsToCreate = [];
    const eventIdsSet = new Set();

    // Load existing IDs
    const existing = await base44.asServiceRole.entities.StormEvent.list('-created_date', 5000);
    existing.forEach(e => eventIdsSet.add(e.event_id));

    // FETCH IEM DATA
    const stateList = Array.from(targetStates);
    console.log(`🔎 Processing ${stateList.length} states using lsr.php...`);

    await processInBatches(stateList, 5, async (stateCode) => {
        console.log(`📡 Fetching state: ${stateCode}`);
        
        try {
            // Format timestamps for lsr.php (YYYY-MM-DDTHH:MM)
            const sts = startDate.toISOString().substring(0, 16);
            const ets = now.toISOString().substring(0, 16);
            
            // Use local time for IEM usually, but UTC is safer if specifying Z. 
            // lsr.php usually takes YYYYMMDDHHMM in UTC.
            // Let's use the format that works: ISO8601 usually works if encoded.
            // But standard lsr.php usage is sts=202401010000.
            
            // Let's try ISO first as standard.
            const iemUrl = `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${sts}&ets=${ets}&states=${stateCode}`;
            
            console.log(`🌐 Fetching: ${iemUrl}`);

            const iemResponse = await fetch(iemUrl, {
              headers: { 'User-Agent': 'Base44-CRM/1.0' }
            });

            if (iemResponse.ok) {
                const data = await iemResponse.json();
                const features = data.features || [];
                console.log(`   ✅ ${stateCode}: Received ${features.length} reports`);
                
                for (const feature of features) {
                    const props = feature.properties;
                    const coords = feature.geometry?.coordinates;
                    if (!coords || coords.length < 2) continue;

                    const longitude = coords[0];
                    const latitude = coords[1];
                    
                    const state = props.state || stateCode;
                    const typeCode = props.type || '';
                    const remark = (props.remark || '').toUpperCase();

                    let eventType = null;
                    let severity = 'moderate';
                    let hailSize = null;
                    let windSpeed = null;

                    if (typeCode === 'H') {
                        eventType = 'hail';
                        hailSize = props.magnitude ? parseFloat(props.magnitude) : 0.5;
                        if (hailSize >= 2.0) severity = 'extreme';
                        else if (hailSize >= 1.0) severity = 'severe';
                        else if (hailSize >= 0.75) severity = 'moderate';
                        else severity = 'minor';
                    } else if (typeCode === 'G' || typeCode === 'D' || typeCode === 'M') {
                        eventType = 'high_wind';
                        windSpeed = props.magnitude ? parseFloat(props.magnitude) : 50;
                        if (windSpeed >= 100) severity = 'extreme';
                        else if (windSpeed >= 75) severity = 'severe';
                        else if (windSpeed >= 58) severity = 'moderate';
                        else severity = 'minor';
                    } else if (typeCode === 'T') {
                        eventType = 'tornado';
                        severity = 'extreme';
                    } else if (typeCode === 'W' || typeCode === 'R') {
                        eventType = 'thunderstorm';
                        windSpeed = props.magnitude ? parseFloat(props.magnitude) : null;
                        if (windSpeed && windSpeed >= 58) severity = 'severe';
                        else severity = 'moderate';
                    } else if (typeCode === 'F' || typeCode === 'E') {
                        eventType = 'flood';
                        severity = 'moderate';
                    }

                    if (!eventType) continue;

                    const eventTime = props.valid; // ISO string
                    const eventId = `IEM_${state}_${eventType}_${latitude}_${longitude}_${eventTime}`;

                    if (!eventIdsSet.has(eventId)) {
                        eventIdsSet.add(eventId);
                        eventsToCreate.push({
                            event_id: eventId,
                            event_type: eventType,
                            severity: severity,
                            title: `${eventType.toUpperCase()} - ${props.city}, ${state}`,
                            description: remark,
                            affected_areas: [`${props.city}, ${state}`],
                            start_time: eventTime,
                            latitude: latitude,
                            longitude: longitude,
                            radius_miles: 10,
                            hail_size_inches: hailSize,
                            wind_speed_mph: windSpeed,
                            status: 'ended',
                            source: 'IEM V2'
                        });
                    }
                }
            } else {
                 console.error(`❌ IEM fetch failed for ${stateCode}: ${iemResponse.status}`);
            }
        } catch (error) {
            console.error(`❌ Error fetching ${stateCode}:`, error.message);
        }
    });

    if (eventsToCreate.length > 0) {
        console.log(`💾 Saving ${eventsToCreate.length} new events...`);
        // Save in batches properly (smaller chunks with delay to avoid 429s)
        const chunkSize = 25;
        for (let i = 0; i < eventsToCreate.length; i += chunkSize) {
            const batch = eventsToCreate.slice(i, i + chunkSize);
            try {
                await base44.asServiceRole.entities.StormEvent.bulkCreate(batch);
                // Small delay to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (err) {
                console.error(`⚠️ Bulk save failed for batch ${Math.floor(i/chunkSize) + 1}, trying individually:`, err.message);
                // Fallback: Try individually with delay
                for (const evt of batch) {
                    try {
                        await base44.asServiceRole.entities.StormEvent.create(evt);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } catch (e) {
                         // Ignore duplicates
                    }
                }
            }
        }
    }

    // Count distinct events for Ohio
    const ohioEvents = eventsToCreate.filter(e => e.affected_areas.some(a => a.includes(', OH'))).length;
    
    // Also count existing Ohio events in DB (simple check)
    // We can't easily filter existing array for Ohio string without fetching all, but we have new ones.

    return Response.json({
      success: true,
      newEvents: eventsToCreate.length,
      ohioNewEvents: ohioEvents,
      message: `Processed ${eventsToCreate.length} new events.`
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({ error: String(error), stack: error.stack }, { status: 500 });
  }
});