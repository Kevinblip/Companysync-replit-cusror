import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { address } = await req.json();
        const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
        let googleError = null;

        // Try Google Maps first
        if (apiKey) {
            try {
                const geoResponse = await fetch(
                  `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
                );
                const data = await geoResponse.json();
                
                if (data.status === 'OK' && data.results[0]) {
                    return Response.json({
                        lat: data.results[0].geometry.location.lat,
                        lng: data.results[0].geometry.location.lng,
                        formatted_address: data.results[0].formatted_address
                    });
                }
                googleError = `Google status: ${data.status}`;
                console.error(`Google Geocoding failed for "${address}":`, data);
            } catch (e) {
                googleError = e.message;
                console.error("Google Geocoding exception:", e);
            }
        }

        // Fallback to OpenStreetMap (Nominatim)
        console.log(`Trying Nominatim fallback for "${address}" (Google error: ${googleError})`);
        try {
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
            const nominatimResp = await fetch(nominatimUrl, {
                headers: {
                    'User-Agent': 'Base44App/1.0 (base44.ai)'
                }
            });
            
            if (nominatimResp.ok) {
                const nominatimData = await nominatimResp.json();
                
                if (nominatimData && nominatimData.length > 0) {
                    return Response.json({
                        lat: parseFloat(nominatimData[0].lat),
                        lng: parseFloat(nominatimData[0].lon),
                        formatted_address: nominatimData[0].display_name
                    });
                }
            }
        } catch (e) {
            console.error("Nominatim Geocoding exception:", e);
        }

        return Response.json({ error: `Geocoding failed. Google: ${googleError || 'Not configured/failed'}. OSM: Not found.` }, { status: 400 });

    } catch (error) {
        console.error("Geocoding function error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});