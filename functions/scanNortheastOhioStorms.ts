import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🌪️ Scanning Northeast Ohio for high winds and hail...');

    const newEvents = [];
    const now = new Date();
    
    // Northeast Ohio focus counties
    const neOhioCounties = [
      'Cuyahoga', 'Summit', 'Lorain', 'Medina', 'Lake', 'Geauga', 
      'Portage', 'Stark', 'Wayne', 'Mahoning', 'Trumbull'
    ];

    // Scan last 90 days for significant events
    const dates = [];
    for (let i = 0; i < 90; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
      dates.push({ dateStr, readable: date.toISOString().split('T')[0] });
    }

    console.log(`📅 Scanning ${dates.length} days of storm reports for NE Ohio...`);

    for (const { dateStr, readable } of dates) {
      try {
        // Fetch SPC storm reports
        let spcUrl = `https://www.spc.noaa.gov/climo/reports/${dateStr}_rpts_filtered.csv`;
        let spcResponse = await fetch(spcUrl);
        
        if (!spcResponse.ok) {
          spcUrl = `https://www.spc.noaa.gov/climo/reports/${dateStr}_rpts.csv`;
          spcResponse = await fetch(spcUrl);
        }
        
        if (spcResponse.ok) {
          const csvText = await spcResponse.text();
          const lines = csvText.split('\n').slice(1); // Skip header
          
          let dayCount = 0;
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const parts = line.split(',');
            if (parts.length < 8) continue;

            const [time, speed, event, size, location, county, state, lat, lon, ...commentsParts] = parts;
            const comments = commentsParts.join(',');
            
            // Filter for Ohio only
            if (state !== 'OH') continue;
            
            // Filter for NE Ohio counties
            if (!neOhioCounties.some(c => county.includes(c))) continue;
            
            // Filter for high winds (>=58 mph) or significant hail (>=1 inch)
            const eventLower = event.toLowerCase();
            let isSignificant = false;
            let hailSize = null;
            let windSpeed = null;
            let eventType = 'thunderstorm';
            let severity = 'moderate';
            
            if (eventLower.includes('hail')) {
              eventType = 'hail';
              const sizeMatch = size.match(/(\d+\.?\d*)/);
              if (sizeMatch) {
                hailSize = parseFloat(sizeMatch[1]);
                if (hailSize >= 1.0) { // 1 inch+ hail (quarter size+)
                  isSignificant = true;
                  if (hailSize >= 2.75) severity = 'extreme'; // Baseball+
                  else if (hailSize >= 2) severity = 'severe'; // Golf ball+
                  else severity = 'moderate';
                }
              }
            } else if (eventLower.includes('wind')) {
              eventType = 'high_wind';
              const speedMatch = speed.match(/(\d+)/);
              if (speedMatch) {
                windSpeed = parseInt(speedMatch[1]);
                if (windSpeed >= 58) { // Damaging winds
                  isSignificant = true;
                  if (windSpeed >= 90) severity = 'extreme';
                  else if (windSpeed >= 75) severity = 'severe';
                  else severity = 'moderate';
                }
              }
            } else if (eventLower.includes('torn')) {
              eventType = 'tornado';
              severity = 'extreme';
              isSignificant = true;
            }
            
            if (!isSignificant) continue;
            
            dayCount++;
            
            // Parse coordinates
            const latitude = parseFloat(lat);
            const longitude = parseFloat(lon);
            
            if (isNaN(latitude) || isNaN(longitude)) continue;
            
            const eventId = `SPC_${dateStr}_${eventType}_${lat}_${lon}_${time.replace(/:/g, '')}`;
            
            // Check if already exists
            const existing = await base44.asServiceRole.entities.StormEvent.filter({ event_id: eventId });
            if (existing.length > 0) continue;

            // Determine radius
            let radiusMiles = 5;
            if (eventType === 'tornado') radiusMiles = 15;
            else if (eventType === 'hail' && hailSize >= 2) radiusMiles = 10;
            else if (eventType === 'high_wind' && windSpeed >= 75) radiusMiles = 12;

            const stormEvent = {
              event_id: eventId,
              event_type: eventType,
              severity: severity,
              title: `${event} - ${location}, ${county} County`,
              description: comments || `${event} reported in ${location}, ${county} County, OH`,
              affected_areas: [`${county} County, OH`, `${location}, OH`],
              start_time: new Date(`${readable}T${time}`).toISOString(),
              latitude: latitude,
              longitude: longitude,
              radius_miles: radiusMiles,
              hail_size_inches: hailSize,
              wind_speed_mph: windSpeed,
              status: 'ended',
              source: 'NOAA SPC',
              noaa_url: `https://www.spc.noaa.gov/climo/reports/${dateStr}_rpts.html`
            };

            const created = await base44.asServiceRole.entities.StormEvent.create(stormEvent);
            newEvents.push(created);
            console.log(`✅ ${readable}: ${event} in ${location}, ${county} County - ${hailSize ? hailSize + '" hail' : windSpeed + ' mph winds'}`);
          }
          
          if (dayCount > 0) {
            console.log(`  📊 ${readable}: Found ${dayCount} significant events in NE Ohio`);
          }
        }
      } catch (error) {
        console.error(`Error processing ${dateStr}:`, error.message);
      }
    }

    const summary = {
      days_scanned: dates.length,
      total_events_found: newEvents.length,
      by_type: {
        hail: newEvents.filter(e => e.event_type === 'hail').length,
        high_wind: newEvents.filter(e => e.event_type === 'high_wind').length,
        tornado: newEvents.filter(e => e.event_type === 'tornado').length,
      },
      by_severity: {
        extreme: newEvents.filter(e => e.severity === 'extreme').length,
        severe: newEvents.filter(e => e.severity === 'severe').length,
        moderate: newEvents.filter(e => e.severity === 'moderate').length,
      },
      most_recent: newEvents[0] ? {
        date: newEvents[0].start_time,
        type: newEvents[0].event_type,
        location: newEvents[0].title
      } : null
    };

    console.log('✅ Scan complete:', summary);

    return Response.json({
      success: true,
      summary,
      events: newEvents.slice(0, 20), // First 20 for preview
      message: `Scanned ${dates.length} days - Found ${newEvents.length} significant storm events in NE Ohio`
    });

  } catch (error) {
    console.error('❌ NE Ohio storm scan error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});