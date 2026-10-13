import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId, entityType } = await req.json();

    if (!companyId || !entityType) {
      return Response.json({ error: 'Missing companyId or entityType' }, { status: 400 });
    }

    // Get round robin settings
    const settings = await base44.asServiceRole.entities.RoundRobinSettings.filter({ company_id: companyId });
    
    if (!settings || settings.length === 0) {
      return Response.json({ 
        assigned: false, 
        message: 'Round robin not configured' 
      });
    }

    const config = settings[0];

    // Check if round robin is enabled
    if (!config.enabled) {
      return Response.json({ 
        assigned: false, 
        message: 'Round robin is disabled' 
      });
    }

    // Check if this entity type should be auto-assigned
    if (config.assignment_type === 'leads' && entityType !== 'lead') {
      return Response.json({ assigned: false, message: 'Only leads are configured for round robin' });
    }
    if (config.assignment_type === 'customers' && entityType !== 'customer') {
      return Response.json({ assigned: false, message: 'Only customers are configured for round robin' });
    }

    // Check business hours if enabled
    if (config.business_hours_only) {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      
      if (currentTime < config.business_hours_start || currentTime > config.business_hours_end) {
        return Response.json({ 
          assigned: false, 
          message: 'Outside business hours' 
        });
      }
    }

    // Check weekends if enabled
    if (config.skip_weekends) {
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return Response.json({ 
          assigned: false, 
          message: 'Weekends are skipped' 
        });
      }
    }

    // Get eligible staff
    const eligibleStaff = config.eligible_staff || [];
    
    if (eligibleStaff.length === 0) {
      return Response.json({ 
        assigned: false, 
        message: 'No eligible staff members' 
      });
    }

    // Get next staff member in rotation
    const currentIndex = config.last_assigned_index || 0;
    const nextIndex = (currentIndex + 1) % eligibleStaff.length;
    const assignedTo = eligibleStaff[nextIndex];

    // Update last assigned index
    await base44.asServiceRole.entities.RoundRobinSettings.update(config.id, {
      last_assigned_index: nextIndex
    });

    return Response.json({
      assigned: true,
      assignedTo: assignedTo,
      assignedToEmail: assignedTo,
      nextIndex: nextIndex,
      totalStaff: eligibleStaff.length
    });

  } catch (error) {
    console.error('Round robin assignment error:', error);
    return Response.json({ 
      error: error.message,
      assigned: false 
    }, { status: 500 });
  }
});