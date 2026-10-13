import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companies = await base44.asServiceRole.entities.Company.list();
    const myCompany = companies.find(c => c.created_by === user.email);
    
    if (!myCompany) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get all territories and rep locations
    const territories = await base44.asServiceRole.entities.Territory.filter({ 
      company_id: myCompany.id,
      is_active: true 
    });
    
    const repLocations = await base44.asServiceRole.entities.RepLocation.filter({ 
      company_id: myCompany.id,
      is_active: true 
    });

    const violations = [];
    const compliance = [];

    // Check each rep location against their assigned territory
    for (const repLocation of repLocations) {
      // Find territories assigned to this rep
      const assignedTerritories = territories.filter(t => 
        t.assigned_reps?.includes(repLocation.rep_email)
      );

      if (assignedTerritories.length === 0) {
        continue; // No territory assigned, skip
      }

      let isInTerritory = false;

      // Check if rep is in any of their assigned territories
      for (const territory of assignedTerritories) {
        if (isPointInPolygon(
          { lat: repLocation.latitude, lng: repLocation.longitude },
          territory.boundary_points
        )) {
          isInTerritory = true;
          compliance.push({
            rep_email: repLocation.rep_email,
            rep_name: repLocation.rep_name,
            territory_name: territory.name,
            status: 'in_territory',
            location: repLocation.address
          });
          break;
        }
      }

      // Rep is outside all assigned territories
      if (!isInTerritory) {
        violations.push({
          rep_email: repLocation.rep_email,
          rep_name: repLocation.rep_name,
          assigned_territories: assignedTerritories.map(t => t.name),
          current_location: repLocation.address,
          latitude: repLocation.latitude,
          longitude: repLocation.longitude,
          timestamp: new Date().toISOString()
        });

        // Send notification
        await base44.asServiceRole.entities.Notification.create({
          company_id: myCompany.id,
          user_email: user.email, // Notify manager
          type: 'geofence_violation',
          title: '⚠️ Territory Violation',
          message: `${repLocation.rep_name} is outside their assigned territory`,
          link_url: '/field-sales-tracker',
          is_read: false
        });
      }
    }

    return Response.json({
      success: true,
      violations,
      compliance,
      totalReps: repLocations.length,
      inCompliance: compliance.length,
      outOfBounds: violations.length
    });

  } catch (error) {
    console.error('Territory compliance check error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});

// Point in polygon algorithm (Ray casting)
function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    
    const intersect = ((yi > point.lng) !== (yj > point.lng))
        && (point.lat < (xj - xi) * (point.lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}