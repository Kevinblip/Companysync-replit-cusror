import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { job_latitude, job_longitude, required_specialty, company_id } = await req.json();

    if (!job_latitude || !job_longitude) {
      return Response.json({ error: 'job_latitude and job_longitude required' }, { status: 400 });
    }

    // Get all active subcontractors for this company
    const subcontractors = await base44.entities.Subcontractor.filter({
      company_id: company_id,
      is_active: true
    });

    const availableSubcontractors = [];

    for (const sub of subcontractors) {
      // Skip if no location data
      if (!sub.base_latitude || !sub.base_longitude) {
        continue;
      }

      // Calculate distance from job to subcontractor's base
      const distance = calculateDistance(
        sub.base_latitude,
        sub.base_longitude,
        job_latitude,
        job_longitude
      );

      const serviceRadius = sub.service_radius_miles || 30;

      // Check if job is within service radius
      if (distance <= serviceRadius) {
        // Check specialty match if required
        if (required_specialty) {
          if (!sub.specialty || !sub.specialty.includes(required_specialty)) {
            continue;
          }
        }

        availableSubcontractors.push({
          id: sub.id,
          name: sub.name,
          contact_person: sub.contact_person,
          phone: sub.phone,
          email: sub.email,
          distance_miles: Math.round(distance * 10) / 10,
          service_radius_miles: serviceRadius,
          specialty: sub.specialty,
          hourly_rate: sub.hourly_rate,
          per_job_rate: sub.per_job_rate,
          rating: sub.rating,
          total_jobs_completed: sub.total_jobs_completed
        });
      }
    }

    // Sort by distance (closest first)
    availableSubcontractors.sort((a, b) => a.distance_miles - b.distance_miles);

    return Response.json({
      success: true,
      job_location: { latitude: job_latitude, longitude: job_longitude },
      available_count: availableSubcontractors.length,
      subcontractors: availableSubcontractors
    });

  } catch (error) {
    console.error('Error finding subcontractors:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});