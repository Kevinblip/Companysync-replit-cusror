import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cityName, repEmails, companyId } = await req.json();
    
    if (!cityName || !repEmails || repEmails.length === 0) {
      return Response.json({ error: 'City name and reps required' }, { status: 400 });
    }

    // Geocode city to get bounds
    const geoResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}`
    );
    const geoData = await geoResponse.json();
    
    if (!geoData || geoData.length === 0) {
      return Response.json({ error: 'City not found' }, { status: 404 });
    }

    const cityCenter = {
      lat: parseFloat(geoData[0].lat),
      lng: parseFloat(geoData[0].lon)
    };
    
    // Get bounding box
    const bbox = geoData[0].boundingbox; // [min_lat, max_lat, min_lon, max_lon]
    
    // Use AI to generate intelligent territory divisions
    const prompt = `You are a territory planning assistant. Divide ${cityName} into ${repEmails.length} equal-sized territories.

City center: ${cityCenter.lat}, ${cityCenter.lng}
Bounding box: 
- Min Lat: ${bbox[0]}, Max Lat: ${bbox[1]}
- Min Lng: ${bbox[2]}, Max Lng: ${bbox[3]}

Create ${repEmails.length} territory polygons that:
1. Cover the entire city area
2. Are roughly equal in size
3. Don't overlap
4. Form logical geographic divisions (like north/south/east/west or quadrants)

For ${repEmails.length} territories, suggest a logical division pattern (e.g., 2=north/south, 3=north/central/south, 4=quadrants, etc.)

Return ONLY a JSON array with ${repEmails.length} polygons. Each polygon should have 4-6 boundary points forming a simple shape.`;

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          territories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                boundary_points: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    // Generate colors
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    
    // Get staff names
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
      company_id: companyId 
    });
    
    const territories = [];
    
    for (let idx = 0; idx < aiResponse.territories.slice(0, repEmails.length).length; idx++) {
      const territory = aiResponse.territories[idx];
      const repEmail = repEmails[idx];
      const staff = staffProfiles.find(s => s.user_email === repEmail);
      const repName = staff?.full_name || repEmail.split('@')[0];
      
      // Calculate center
      const points = territory.boundary_points;
      const centerLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
      const centerLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
      
      // Find northernmost (start) and southernmost (end) points
      let northPoint = points[0];
      let southPoint = points[0];
      
      points.forEach(p => {
        if (p.lat > northPoint.lat) northPoint = p;
        if (p.lat < southPoint.lat) southPoint = p;
      });
      
      // Reverse geocode start point
      let startAddress = '';
      try {
        const startGeoResponse = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${northPoint.lat}&lon=${northPoint.lng}`
        );
        const startGeoData = await startGeoResponse.json();
        startAddress = startGeoData.display_name || `${northPoint.lat.toFixed(4)}, ${northPoint.lng.toFixed(4)}`;
      } catch (error) {
        startAddress = `${northPoint.lat.toFixed(4)}, ${northPoint.lng.toFixed(4)}`;
      }
      
      // Reverse geocode end point
      let endAddress = '';
      try {
        const endGeoResponse = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${southPoint.lat}&lon=${southPoint.lng}`
        );
        const endGeoData = await endGeoResponse.json();
        endAddress = endGeoData.display_name || `${southPoint.lat.toFixed(4)}, ${southPoint.lng.toFixed(4)}`;
      } catch (error) {
        endAddress = `${southPoint.lat.toFixed(4)}, ${southPoint.lng.toFixed(4)}`;
      }
      
      // Determine route direction
      let routeNotes = "Start north and work your way south";
      if (territory.name && territory.name.toLowerCase().includes('east')) {
        routeNotes = "Start east and work your way west, focus on main streets first";
      } else if (territory.name && territory.name.toLowerCase().includes('west')) {
        routeNotes = "Start west and work your way east, cover residential areas";
      } else if (territory.name && territory.name.toLowerCase().includes('central')) {
        routeNotes = "Start from center and work outward in a circular pattern";
      }
      
      territories.push({
        name: `${cityName} - ${territory.name || repName}`,
        description: `Auto-generated territory for ${repName} in ${cityName}`,
        color: colors[idx % colors.length],
        assigned_reps: [repEmail],
        boundary_points: points,
        center_lat: centerLat,
        center_lng: centerLng,
        start_address: startAddress,
        start_lat: northPoint.lat,
        start_lng: northPoint.lng,
        end_address: endAddress,
        end_lat: southPoint.lat,
        end_lng: southPoint.lng,
        route_notes: routeNotes,
        company_id: companyId
      });
    }

    // Create all territories in database
    const createdTerritories = [];
    for (const territory of territories) {
      const created = await base44.asServiceRole.entities.Territory.create(territory);
      createdTerritories.push(created);
    }

    return Response.json({ 
      success: true, 
      territories: createdTerritories,
      cityCenter
    });

  } catch (error) {
    console.error('Territory generation error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});