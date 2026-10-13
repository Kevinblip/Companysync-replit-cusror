import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Regional storm data collector - designed to run as scheduled task
// Divides US into regions to avoid timeout issues

Deno.serve(async (req) => {
  try {


    console.log('⚡ fetchStormDataRegion invoked');
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    
    // Region parameter: 'northeast', 'southeast', 'midwest', 'southwest', 'west', 'mountain'
    const region = body.region || 'northeast';
    const daysBack = body.daysBack || 7;

    // Regional state groupings for efficient processing
    const regionMap = {
      northeast: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'MD', 'DE'],
      southeast: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN', 'KY'],
      midwest: ['OH', 'IN', 'IL', 'MI', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS'],
      southwest: ['TX', 'OK', 'AR', 'LA'],
      mountain: ['MT', 'ID', 'WY', 'CO', 'NM', 'AZ', 'UT', 'NV'],
      west: ['WA', 'OR', 'CA', 'AK', 'HI']
    };

    const targetStates = regionMap[region] || regionMap.northeast;
    console.log(`🌪️ [${region.toUpperCase()}] Fetching storms for ${targetStates.length} states: ${targetStates.join(', ')}`);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysBack);

    let newEvents = 0;
    let duplicates = 0;

    // Fetch from IEM (Iowa Environmental Mesonet) - Historical hail/wind data
    for (const state of targetStates) {
      try {
        const startStr = startDate.toISOString().split('.')[0] + 'Z';
        const endStr = now.toISOString().split('.')[0] + 'Z';
        const iemUrl = `https://mesonet.agron.iastate.edu/api/1/lsr.geojson?begints=${startStr}&endts=${endStr}&states=${state}`;

        const iemResponse = await fetch(iemUrl, {
          headers: { 'User-Agent': 'Base44-CRM/1.0 (contact@base44.io)' }
        });

        if (iemResponse.ok) {
          const data = await iemResponse.json();
          const features = data.features || [];
          
          for (const feature of features) {
            const props = feature.properties;
            const coords = feature.geometry?.coordinates;
            
            if (!coords || coords.length < 2) continue;
            
            const longitude = coords[0];
            const latitude = coords[1];
            
            if (isNaN(latitude) || isNaN(longitude)) continue;
            
            let eventType = null;
            let severity = 'moderate';
            let hailSize = null;
            let windSpeed = null;

            const typeCode = props.type?.toUpperCase();

            if (typeCode === 'H' || typeCode === 'HAIL') {
              eventType = 'hail';
              hailSize = parseFloat(props.magnitude) || 0.5;
              if (hailSize >= 2.75) severity = 'extreme';
              else if (hailSize >= 2.0) severity = 'severe';
              else if (hailSize >= 1.0) severity = 'moderate';
              else severity = 'minor';
            } else if (typeCode === 'D' || typeCode === 'G' || typeCode === 'WIND') {
              eventType = 'high_wind';
              windSpeed = parseFloat(props.magnitude) || 45;
              if (windSpeed >= 90) severity = 'extreme';
              else if (windSpeed >= 75) severity = 'severe';
              else if (windSpeed >= 58) severity = 'moderate';
              else if (windSpeed >= 40) severity = 'minor';
              else severity = 'minor';
            } else if (typeCode === 'T' || typeCode === 'TORNADO') {
              eventType = 'tornado';
              severity = 'extreme';
            }

            if (!eventType) continue;
            
            const eventTime = props.valid || props.utc_valid;
            const eventId = `IEM_${state}_${eventType}_${latitude.toFixed(4)}_${longitude.toFixed(4)}_${eventTime}`;

            // Check for duplicates
            const existing = await base44.asServiceRole.entities.StormEvent.filter({ event_id: eventId });
            if (existing.length > 0) {
              duplicates++;
              continue;
            }
            
            let radiusMiles = 5;
            if (eventType === 'tornado') radiusMiles = 15;
            else if (eventType === 'hail' && hailSize >= 2) radiusMiles = 10;
            else if (eventType === 'high_wind' && windSpeed >= 75) radiusMiles = 12;
            
            const location = props.city || props.county || 'Unknown';
            const county = props.county || 'Unknown County';
            
            await base44.asServiceRole.entities.StormEvent.create({
              event_id: eventId,
              event_type: eventType,
              severity: severity,
              title: `${eventType === 'hail' ? `${hailSize}" Hail` : eventType === 'high_wind' ? `${windSpeed} mph Wind` : 'Tornado'} - ${location}, ${state}`,
              description: props.remark || `${eventType} reported in ${location}, ${county}, ${state}`,
              affected_areas: [`${county}, ${state}`, `${location}, ${state}`],
              start_time: new Date(eventTime).toISOString(),
              latitude: latitude,
              longitude: longitude,
              radius_miles: radiusMiles,
              hail_size_inches: hailSize,
              wind_speed_mph: windSpeed,
              status: 'ended',
              source: `Iowa Mesonet (${region})`,
              noaa_url: `https://mesonet.agron.iastate.edu/lsr/`
            });
            
            newEvents++;
          }
        }
      } catch (error) {
        console.error(`Error fetching ${state}:`, error.message);
      }
      
      // Breathe between states
      await new Promise(r => setTimeout(r, 300));
    }

    // Fetch NWS Active Alerts for this region
    for (const state of targetStates.slice(0, 5)) { // Limit to 5 states to avoid timeout
      try {
        const nwsUrl = `https://api.weather.gov/alerts?area=${state}&status=actual&severity=Severe,Extreme,Moderate&limit=50`;
        
        const nwsResponse = await fetch(nwsUrl, { 
          headers: { 'User-Agent': '(Base44-CRM, contact@base44.io)' }
        });
        
        if (nwsResponse.ok) {
          const nwsData = await nwsResponse.json();
          const features = nwsData.features || [];

          for (const feature of features) {
            const props = feature.properties;
            const eventName = (props.event || '').toLowerCase();
            
            // Skip non-roof-damaging events
            if (eventName.includes('winter') || eventName.includes('flood') || 
                eventName.includes('freeze') || eventName.includes('fog') || 
                eventName.includes('heat') || eventName.includes('fire')) {
              continue;
            }

            let eventType = null;
            let severity = 'moderate';

            if (eventName.includes('tornado')) {
              eventType = 'tornado';
              severity = eventName.includes('warning') ? 'extreme' : 'severe';
            } else if (eventName.includes('severe thunderstorm')) {
              eventType = 'thunderstorm';
              severity = eventName.includes('warning') ? 'severe' : 'moderate';
            } else if (eventName.includes('high wind') || eventName.includes('wind')) {
              eventType = 'high_wind';
              if (eventName.includes('warning')) severity = 'severe';
              else if (eventName.includes('watch')) severity = 'moderate';
              else severity = 'minor';
            }

            if (!eventType) continue;

            const eventId = props.id || `NWS_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const existing = await base44.asServiceRole.entities.StormEvent.filter({ event_id: eventId });
            if (existing.length > 0) {
              duplicates++;
              continue;
            }

            // Extract geometry
            let latitude = null;
            let longitude = null;
            const geometry = feature.geometry;
            
            if (geometry && geometry.coordinates) {
              if (geometry.type === 'Polygon' && geometry.coordinates[0]?.length > 0) {
                let sumLat = 0, sumLon = 0, count = 0;
                geometry.coordinates[0].forEach(coord => {
                  sumLon += coord[0];
                  sumLat += coord[1];
                  count++;
                });
                latitude = sumLat / count;
                longitude = sumLon / count;
              }
            }

            const affectedAreas = props.areaDesc ? props.areaDesc.split(';').map(a => a.trim()).filter(Boolean) : [];

            await base44.asServiceRole.entities.StormEvent.create({
              event_id: eventId,
              event_type: eventType,
              severity: severity,
              title: props.event || 'Storm Alert',
              description: props.headline || props.description || '',
              affected_areas: affectedAreas,
              start_time: props.onset || props.sent || new Date().toISOString(),
              end_time: props.ends || props.expires,
              latitude: latitude,
              longitude: longitude,
              radius_miles: 25,
              status: 'active',
              source: `NWS (${region})`,
              noaa_url: props['@id'] || 'https://www.weather.gov/'
            });
            
            newEvents++;
          }
        }
      } catch (error) {
        console.error(`NWS error for ${state}:`, error.message);
      }
      
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`✅ [${region.toUpperCase()}] Complete: ${newEvents} new storms, ${duplicates} duplicates skipped`);

    return Response.json({
      success: true,
      region: region,
      states_processed: targetStates.length,
      new_events: newEvents,
      duplicates_skipped: duplicates
    });

  } catch (error) {
    console.error('❌ Regional storm fetch error:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});