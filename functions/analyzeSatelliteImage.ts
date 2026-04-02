import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// FORCE UPDATE V4 - Enhanced vision analysis with measurement indicators
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
        
        console.log(`Starting analysis V4 for: ${address}`);

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
                console.warn(`Google Geocoding failed: ${geoData.status}`);
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

        // 2. Generate Satellite URL & Upload to Storage
        const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=600x600&maptype=satellite&key=${apiKey}`;
        console.log(`Fetching static map: ${staticMapUrl}`);
        
        let satellite_image_url = staticMapUrl;
        
        try {
            const mapResp = await fetch(staticMapUrl);
            if (mapResp.ok) {
                const mapBlob = await mapResp.blob();
                console.log(`Downloaded map blob type: ${mapBlob.type}, size: ${mapBlob.size}`);
                
                const mapFile = new File([mapBlob], "satellite_view.png", { type: "image/png" });
                
                console.log('Uploading satellite image to storage...');
                const uploadRes = await base44.integrations.Core.UploadFile({ file: mapFile });
                if (uploadRes && uploadRes.file_url) {
                    satellite_image_url = uploadRes.file_url;
                    console.log(`Uploaded satellite URL: ${satellite_image_url}`);
                } else {
                    console.warn('UploadFile returned no file_url');
                }
            } else {
                console.warn(`Static Map API fetch failed: ${mapResp.status} ${mapResp.statusText}`);
            }
        } catch (e) {
            console.error('Error fetching/uploading static map:', e);
        }

        // 3. Analyze with AI - Enhanced prompt for measurement indicators
        console.log('Invoking LLM for enhanced analysis...');
        const analysis = await base44.integrations.Core.InvokeLLM({
            prompt: `You are a professional roofing estimator analyzing a satellite/aerial image of a property at ${address}.

Perform a detailed roof analysis focusing on MEASUREMENT INDICATORS:

1. ROOF TYPE CLASSIFICATION: Identify the primary roof style (gable, hip, dutch hip, gambrel, mansard, flat, shed, complex/combination). If combination, list each style present.

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
                    length_width_ratio: { type: "number", description: "Approximate ratio of building length to width (e.g. 1.5 means 50% longer than wide)" },
                    linear_features: {
                        type: "object",
                        properties: {
                            ridge_count: { type: "number", description: "Number of ridge lines" },
                            ridge_details: { type: "string", description: "Description of ridge lines including relative lengths" },
                            hip_count: { type: "number", description: "Number of hip lines" },
                            hip_details: { type: "string", description: "Description of hip lines" },
                            valley_count: { type: "number", description: "Number of valley lines" },
                            valley_details: { type: "string", description: "Description of valley lines" },
                            rake_count: { type: "number", description: "Number of rake edges (gable ends)" },
                            rake_details: { type: "string", description: "Description of rake edges" },
                            eave_count: { type: "number", description: "Number of eave/drip edge segments" },
                            eave_details: { type: "string", description: "Description of eave lines" }
                        },
                        required: ["ridge_count", "hip_count", "valley_count", "rake_count", "eave_count"]
                    },
                    structural_features: {
                        type: "object",
                        properties: {
                            has_garage: { type: "boolean", description: "Whether an attached garage is visible" },
                            garage_roof_type: { type: "string", description: "Garage roof style if present" },
                            has_additions: { type: "boolean", description: "Whether additions/extensions are visible" },
                            dormer_count: { type: "number", description: "Number of dormers visible" },
                            chimney_count: { type: "number", description: "Number of chimneys visible" },
                            skylight_count: { type: "number", description: "Number of skylights visible" },
                            vent_pipe_count: { type: "number", description: "Estimated number of pipe/vent penetrations" },
                            has_porch_roof: { type: "boolean", description: "Whether a covered porch or entry exists" },
                            other_features: { type: "string", description: "Any other notable roof features" }
                        },
                        required: ["has_garage", "has_additions", "dormer_count", "chimney_count"]
                    },
                    sections_identified: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                section_name: { type: "string", description: "e.g. Main Front Slope, Garage Hip, Addition Rear" },
                                orientation: { type: "string", description: "Compass direction: N, S, E, W, NE, NW, SE, SW" },
                                description: { type: "string", description: "Brief description of this section" },
                                estimated_area_percentage: { type: "number", description: "Estimated percentage of total roof area (0-100)" },
                                pitch_estimate: { type: "string", description: "low (2-4/12), moderate (5-7/12), steep (8-12/12)" },
                                roof_style: { type: "string", description: "gable, hip, flat, shed for this specific section" }
                            },
                            required: ["section_name", "orientation", "description", "estimated_area_percentage", "pitch_estimate"]
                        }
                    },
                    measurement_hints: {
                        type: "object",
                        properties: {
                            estimated_ridge_to_eave_ratio: { type: "number", description: "Ratio of total ridge length to total eave length (hip roofs < 1, gable roofs ~ 1)" },
                            estimated_hip_to_ridge_ratio: { type: "number", description: "Ratio of total hip length to total ridge length (0 for pure gable, high for hip roofs)" },
                            symmetry: { type: "string", description: "symmetric, mostly_symmetric, asymmetric" },
                            dominant_pitch_category: { type: "string", description: "low, moderate, steep" },
                            estimated_stories: { type: "number", description: "Estimated number of stories (1, 1.5, 2, 2.5, 3)" }
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