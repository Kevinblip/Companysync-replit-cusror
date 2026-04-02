import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        const apiKey = Deno.env.get("CREWCAM_API_KEY");
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'CrewCam API Key not configured on the server. Please add it in your app settings.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        const response = await fetch('https://www.mycrewcam.com/api/v1/jobs', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`CrewCam API Error: ${response.status} ${errorText}`);
            // Use the actual error text from the API in the response
            throw new Error(`CrewCam API responded with status ${response.status}. Response: ${errorText}`);
        }

        const data = await response.json();
        
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Error in getCrewCamJobs function:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});