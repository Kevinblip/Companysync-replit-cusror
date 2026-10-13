import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { address } = await req.json();
        if (!address) {
            return Response.json({ error: 'Address is required' }, { status: 400 });
        }

        const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
        }

        // 1. Geocode
        let lat = null;
        let lng = null;
        
        console.log(`Starting enhanced analysis V2 for: ${address}`);

        // Try Google Geocoding first
        try {
            console.log('Attempting Google Geocoding...');
            const geoResponse = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
            );
            const geoData = await geoResponse.json();
            
            if (geoData.status === 'OK' && geoData.results[0]) {
                lat = geoData.results[0].geometry.location.lat;
                lng = geoData.results[0].geometry.location.lng;
                console.log(`Google Geocoding success: ${lat}, ${lng}`);
            } else {
                console.warn(`Google Geocoding failed: ${geoData.status} - ${geoData.error_message || ''}`);
            }
        } catch (e) {
            console.warn(`Google Geocoding exception: ${e.message}`);
        }

        // Fallback to Nominatim if Google failed
        if (!lat || !lng) {
            console.log('Falling back to Nominatim for geocoding...');
            try {
                const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
                const nominatimResp = await fetch(nominatimUrl, {
                    headers: { 'User-Agent': 'Base44App/1.0 (base44.ai)' }
                });
                
                if (nominatimResp.ok) {
                    const nominatimData = await nominatimResp.json();
                    if (nominatimData && nominatimData.length > 0) {
                        lat = parseFloat(nominatimData[0].lat);
                        lng = parseFloat(nominatimData[0].lon);
                        console.log(`Nominatim success: ${lat}, ${lng}`);
                    } else {
                        console.warn('Nominatim returned no results');
                    }
                } else {
                    console.warn(`Nominatim failed: ${nominatimResp.status}`);
                }
            } catch (e) {
                console.error(`Nominatim Geocoding error: ${e.message}`);
            }
        }

        if (!lat || !lng) {
            return Response.json({ error: 'Geocoding failed. Could not determine location.' }, { status: 400 });
        }

        // 2. Generate Satellite URL
        const satellite_image_url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=600x600&maptype=satellite&key=${apiKey}`;
        console.log(`Generated satellite URL: ${satellite_image_url}`);

        // 3. Analyze with AI - Enhanced prompt for measurement indicators
        console.log('Invoking LLM for enhanced analysis...');
        const analysis = await base44.integrations.Core.InvokeLLM({
            prompt: `You are a professional roofing estimator analyzing a satellite/aerial image of a property at ${address}.

Perform a detailed roof analysis focusing on MEASUREMENT INDICATORS:

1. ROOF TYPE CLASSIFICATION: Identify the primary roof style (gable, hip, dutch_hip, gambrel, mansard, flat, shed, complex). If combination, list each style present.

2. ROOF PLANES/FACETS: Count the total number of distinct roof planes visible. For each plane, estimate:
   - Relative size (as percentage of total roof area)
   - Pitch steepness (low/moderate/steep based on shadow indicators)
   - Orientation (compass direction: N, S, E, W, NE, NW, SE, SW)

3. LINEAR FEATURE DETECTION - This is critical for measurement estimation:
   - RIDGE LINES: Count and describe all ridge lines (the highest horizontal lines where two slopes meet at the top). Estimate relative length (short/medium/long compared to building footprint).
   - HIP LINES: Count all hip lines (diagonal lines running from ridge ends down to eaves on hip roofs). Note their approximate angle.
   - VALLEY LINES: Count all valley lines (where two roof planes meet forming an internal angle/channel). These indicate complex intersections.
   - RAKE EDGES: Count rake edges (the sloped edges on gable ends). Each gable end has 2 rake edges.
   - EAVE/DRIP EDGES: Identify all eave lines (horizontal edges at the bottom of roof slopes along the gutterline).

4. STRUCTURAL FEATURES:
   - Detect attached garage (separate roof section or integrated)
   - Detect additions/extensions (roof sections at different heights or angles)
   - Detect dormers (small protruding roof structures with windows)
   - Detect skylights or roof penetrations (vents, pipes, chimneys)
   - Detect porches or covered entries with separate roof sections

5. BUILDING FOOTPRINT SHAPE: Describe the overall building shape from above (rectangular, L-shaped, T-shaped, U-shaped, irregular).

6. APPROXIMATE PROPORTIONS: Using the building footprint as reference:
   - Estimate approximate building length vs width ratio
   - Estimate if the roof has significant overhangs

Provide structured, actionable data that can improve automated roof measurement calculations.`,
            file_urls: [satellite_image_url],
            response_json_schema: {
                type: "object",
                properties: {
                    ai_description: { type: "string", description: "Comprehensive roof description in 2-3 sentences" },
                    roof_type: { type: "string", description: "Primary roof type: gable, hip, dutch_hip, gambrel, mansard, flat, shed, complex" },
                    roof_complexity: { type: "string", description: "simple, moderate, complex, very_complex" },
                    total_roof_planes: { type: "number", description: "Total count of distinct roof planes/facets" },
                    building_footprint_shape: { type: "string", description: "rectangular, L-shaped, T-shaped, U-shaped, irregular" },
                    length_width_ratio: { type: "number", description: "Approximate ratio of building length to width" },
                    linear_features: {
                        type: "object",
                        properties: {
                            ridge_count: { type: "number" },
                            ridge_details: { type: "string" },
                            hip_count: { type: "number" },
                            hip_details: { type: "string" },
                            valley_count: { type: "number" },
                            valley_details: { type: "string" },
                            rake_count: { type: "number" },
                            rake_details: { type: "string" },
                            eave_count: { type: "number" },
                            eave_details: { type: "string" }
                        },
                        required: ["ridge_count", "hip_count", "valley_count", "rake_count", "eave_count"]
                    },
                    structural_features: {
                        type: "object",
                        properties: {
                            has_garage: { type: "boolean" },
                            garage_roof_type: { type: "string" },
                            has_additions: { type: "boolean" },
                            dormer_count: { type: "number" },
                            chimney_count: { type: "number" },
                            skylight_count: { type: "number" },
                            vent_pipe_count: { type: "number" },
                            has_porch_roof: { type: "boolean" },
                            other_features: { type: "string" }
                        },
                        required: ["has_garage", "has_additions", "dormer_count", "chimney_count"]
                    },
                    sections_identified: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                section_name: { type: "string" },
                                orientation: { type: "string" },
                                description: { type: "string" },
                                estimated_area_percentage: { type: "number" },
                                pitch_estimate: { type: "string" },
                                roof_style: { type: "string" }
                            },
                            required: ["section_name", "orientation", "description", "estimated_area_percentage", "pitch_estimate"]
                        }
                    },
                    measurement_hints: {
                        type: "object",
                        properties: {
                            estimated_ridge_to_eave_ratio: { type: "number" },
                            estimated_hip_to_ridge_ratio: { type: "number" },
                            symmetry: { type: "string" },
                            dominant_pitch_category: { type: "string" },
                            estimated_stories: { type: "number" }
                        },
                        required: ["symmetry", "dominant_pitch_category", "estimated_stories"]
                    }
                },
                required: ["ai_description", "roof_type", "roof_complexity", "total_roof_planes", "building_footprint_shape", "linear_features", "structural_features", "sections_identified", "measurement_hints"]
            }
        });

        console.log('LLM Analysis complete');

        return Response.json({
            success: true,
            satellite_image_url,
            roof_layout_analysis: analysis,
            location: { lat, lng }
        });

    } catch (error) {
        console.error('analyzeSatelliteImage critical error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});