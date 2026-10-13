import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { full_name, phone } = await req.json();

    if (!full_name || !full_name.trim()) {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }

    // Update phone on User entity (custom field)
    if (phone !== undefined) {
      await base44.auth.updateMe({ phone });
    }

    // Use service role to update StaffProfile (regular users can't update entities they didn't create)
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });

    if (staffProfiles && staffProfiles.length > 0) {
      const profileId = staffProfiles[0].id;
      await base44.asServiceRole.entities.StaffProfile.update(profileId, {
        full_name: full_name.trim(),
        phone: phone || staffProfiles[0].phone
      });
    } else {
      // No StaffProfile exists yet — create one
      // Find the user's company from their owned companies or any available company
      const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
      const companyId = companies.length > 0 ? companies[0].id : null;

      await base44.asServiceRole.entities.StaffProfile.create({
        user_email: user.email,
        full_name: full_name.trim(),
        phone: phone || '',
        company_id: companyId,
        is_active: true
      });
    }

    return Response.json({ success: true, full_name: full_name.trim(), phone });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});