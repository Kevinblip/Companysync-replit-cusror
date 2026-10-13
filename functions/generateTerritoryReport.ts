import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { repEmail, date } = await req.json();
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999)).toISOString();

    const companies = await base44.asServiceRole.entities.Company.list();
    const myCompany = companies.find(c => c.created_by === user.email);
    
    if (!myCompany) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get activities for the rep on this date
    const allActivities = await base44.asServiceRole.entities.FieldActivity.filter({ 
      company_id: myCompany.id
    });

    const activities = allActivities.filter(a => {
      if (repEmail && a.rep_email !== repEmail) return false;
      const activityDate = new Date(a.created_date);
      return activityDate >= new Date(startOfDay) && activityDate <= new Date(endOfDay);
    });

    // Get assigned territory
    const territories = await base44.asServiceRole.entities.Territory.filter({ 
      company_id: myCompany.id
    });
    
    const assignedTerritory = repEmail 
      ? territories.find(t => t.assigned_reps?.includes(repEmail))
      : null;

    // Calculate metrics
    const totalActivities = activities.length;
    const doorsKnocked = activities.filter(a => a.activity_type === 'door_knock').length;
    const appointmentsSet = activities.filter(a => a.activity_type === 'appointment').length;
    const salesMade = activities.filter(a => a.activity_type === 'sale').length;
    const totalRevenue = activities
      .filter(a => a.activity_type === 'sale')
      .reduce((sum, a) => sum + (a.sale_amount || 0), 0);

    // Calculate time in territory
    let activitiesInTerritory = 0;
    if (assignedTerritory && assignedTerritory.boundary_points?.length >= 3) {
      activitiesInTerritory = activities.filter(a => 
        a.latitude && a.longitude && isPointInPolygon(
          { lat: a.latitude, lng: a.longitude },
          assignedTerritory.boundary_points
        )
      ).length;
    }

    const complianceScore = totalActivities > 0 
      ? Math.round((activitiesInTerritory / totalActivities) * 100)
      : 100;

    // Calculate activity rate (activities per hour)
    const firstActivity = activities[0];
    const lastActivity = activities[activities.length - 1];
    let hoursWorked = 0;
    let activityRate = 0;

    if (firstActivity && lastActivity) {
      const startTime = new Date(firstActivity.created_date);
      const endTime = new Date(lastActivity.created_date);
      hoursWorked = (endTime - startTime) / (1000 * 60 * 60); // Convert to hours
      activityRate = hoursWorked > 0 ? (totalActivities / hoursWorked).toFixed(1) : 0;
    }

    // Find hotspots (areas with most activity)
    const hotspots = [];
    if (activities.length > 0) {
      // Group activities by approximate location (0.01 degree grid ~1km)
      const locationGroups = {};
      activities.forEach(a => {
        if (a.latitude && a.longitude) {
          const gridKey = `${Math.floor(a.latitude * 100)}_${Math.floor(a.longitude * 100)}`;
          if (!locationGroups[gridKey]) {
            locationGroups[gridKey] = {
              lat: a.latitude,
              lng: a.longitude,
              count: 0,
              activities: []
            };
          }
          locationGroups[gridKey].count++;
          locationGroups[gridKey].activities.push(a);
        }
      });

      // Get top 3 hotspots
      hotspots.push(...Object.values(locationGroups)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
      );
    }

    return Response.json({
      success: true,
      report: {
        rep_email: repEmail,
        date: targetDate.toISOString().split('T')[0],
        assigned_territory: assignedTerritory?.name || 'None',
        metrics: {
          total_activities: totalActivities,
          doors_knocked: doorsKnocked,
          appointments_set: appointmentsSet,
          sales_made: salesMade,
          total_revenue: totalRevenue,
          hours_worked: hoursWorked.toFixed(1),
          activity_rate: activityRate
        },
        compliance: {
          activities_in_territory: activitiesInTerritory,
          activities_out_of_territory: totalActivities - activitiesInTerritory,
          compliance_score: complianceScore
        },
        hotspots
      }
    });

  } catch (error) {
    console.error('Territory report error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});

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