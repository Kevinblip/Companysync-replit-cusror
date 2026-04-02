import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// Helper to fetch media from CrewCam API
async function getCrewCamMedia(jobId, apiKey) {
    const possibleEndpoints = [
        `https://www.mycrewcam.com/api/v1/jobs/${jobId}/photos`,
        `https://www.mycrewcam.com/api/v1/jobs/${jobId}/media`,
        `https://api.mycrewcam.com/v1/jobs/${jobId}/photos`
    ];

    for (const url of possibleEndpoints) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.photos || data.media || data; 
            }
        } catch (error) {
            console.log(`Attempted ${url} but failed:`, error.message);
        }
    }
    
    console.warn(`Could not find a valid media endpoint for CrewCam job ${jobId}.`);
    return [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        const { crewCamJob, ladderAssistNeeded = false, ladderAssistantName = '', ladderAssistCost = 100 } = await req.json();
        
        if (!crewCamJob) {
            return new Response(JSON.stringify({ error: 'CrewCam job data is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const apiKey = Deno.env.get("CREWCAM_API_KEY");
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'CrewCam API Key not configured.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        // Check if already synced
        const existingJobs = await base44.entities.InspectionJob.filter({ crew_cam_id: crewCamJob.id });
        if (existingJobs && existingJobs.length > 0) {
             return new Response(JSON.stringify({ message: 'Job already synced.', inspectionJobId: existingJobs[0].id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // Create inspection job with ladder assist info
        const newInspectionJobData = {
            client_name: crewCamJob.customer_name || 'N/A',
            property_address: crewCamJob.address || crewCamJob.name,
            status: 'pending',
            notes: `Imported from CrewCam. Original Job ID: ${crewCamJob.id}. Original Job Name: ${crewCamJob.name}.`,
            crew_cam_id: crewCamJob.id,
            created_by: user.email,
            ladder_assist_needed: ladderAssistNeeded,
            ladder_assistant_name: ladderAssistantName,
            ladder_assist_cost: ladderAssistCost,
            sales_rep_email: user.email
        };

        const newInspectionJob = await base44.entities.InspectionJob.create(newInspectionJobData);

        // Fetch and create media
        const mediaItems = await getCrewCamMedia(crewCamJob.id, apiKey);
        
        if (mediaItems && mediaItems.length > 0) {
            const jobMediaToCreate = mediaItems.map(media => ({
                related_entity_id: newInspectionJob.id,
                related_entity_type: 'InspectionJob',
                file_url: media.url_xl || media.url,
                file_type: media.type === 'video' ? 'video' : 'photo',
                caption: media.caption || `CrewCam Media from Job ${crewCamJob.name}`,
                uploaded_by_name: 'CrewCam Sync',
            }));

            await base44.entities.JobMedia.bulkCreate(jobMediaToCreate);
        }

        // Create deduction record if ladder assist was used
        if (ladderAssistNeeded) {
            await base44.entities.CommissionDeduction.create({
                company_id: newInspectionJob.company_id,
                sales_rep_email: user.email,
                sales_rep_name: user.full_name,
                deduction_type: 'ladder_assist',
                amount: ladderAssistCost,
                description: `Ladder assist for inspection at ${crewCamJob.address || crewCamJob.name}${ladderAssistantName ? ` (Assistant: ${ladderAssistantName})` : ''}`,
                related_inspection_id: newInspectionJob.id,
                deduction_date: new Date().toISOString().split('T')[0],
                pay_period: new Date().toISOString().slice(0, 7), // YYYY-MM
                status: 'pending'
            });
        }

        return new Response(JSON.stringify({ 
            success: true, 
            message: `Job '${crewCamJob.name}' and ${mediaItems.length} media items synced successfully.${ladderAssistNeeded ? ` Ladder assist cost ($${ladderAssistCost}) recorded.` : ''}`,
            inspectionJobId: newInspectionJob.id 
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Error in syncCrewCamJob function:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
});