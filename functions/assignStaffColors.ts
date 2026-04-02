import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Pre-defined color palette for staff members
const COLOR_PALETTE = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#8b5cf6', // Purple
  '#f59e0b', // Orange
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#14b8a6', // Teal
  '#f97316', // Orange-red
  '#eab308', // Yellow
  '#ef4444', // Red
  '#6366f1', // Indigo
  '#84cc16', // Lime
  '#d946ef', // Fuchsia
  '#0ea5e9', // Sky
  '#f43f5e', // Rose
  '#a855f7', // Violet
  '#22c55e', // Green-500
  '#fb923c', // Orange-400
  '#c026d3', // Fuchsia-600
  '#2dd4bf', // Teal-400
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's company
    const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
    let myCompany = companies[0];

    if (!myCompany) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles[0]) {
        const companyId = staffProfiles[0].company_id;
        const companyList = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        myCompany = companyList[0];
      }
    }

    if (!myCompany) {
      return Response.json({ error: 'No company found' }, { status: 404 });
    }

    // Get all staff for this company
    const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: myCompany.id });

    // Generate color mapping
    const staffColors = {};
    allStaff.forEach((staff, index) => {
      const color = COLOR_PALETTE[index % COLOR_PALETTE.length];
      staffColors[staff.user_email] = color;
    });

    // Get or create CalendarSettings
    const existingSettings = await base44.asServiceRole.entities.CalendarSettings.filter({ company_id: myCompany.id });

    if (existingSettings.length > 0) {
      // Update existing
      await base44.asServiceRole.entities.CalendarSettings.update(existingSettings[0].id, {
        staff_colors: staffColors
      });
    } else {
      // Create new
      await base44.asServiceRole.entities.CalendarSettings.create({
        company_id: myCompany.id,
        staff_colors: staffColors
      });
    }

    return Response.json({
      success: true,
      staff_count: allStaff.length,
      colors_assigned: staffColors
    });

  } catch (error) {
    console.error('Error assigning staff colors:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});