import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const targetEmail = body.email || user.email;

    console.log(`🗑️ Request to delete account: ${targetEmail} (Requested by: ${user.email})`);

    // SECURITY: Only super admins can delete accounts
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
    const callerProfile = staffProfiles[0];
    const isSuperAdmin = callerProfile?.is_super_admin === true;

    if (!isSuperAdmin) {
      console.log(`🚫 Denied: ${user.email} is not a super admin`);
      return Response.json({ error: 'Forbidden - Only super admins can delete accounts' }, { status: 403 });
    }

    if (!targetEmail) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    console.log(`🗑️ Processing deletion for: ${targetEmail}`);

    // Use service role to delete from User entity
    try {
      const users = await base44.asServiceRole.entities.User.filter({ email: targetEmail });
      if (users && users.length > 0) {
        for (const u of users) {
          await base44.asServiceRole.entities.User.delete(u.id);
          console.log(`✅ Deleted user record: ${u.id}`);
        }
      } else {
        console.log(`⚠️ No user found with email: ${targetEmail}`);
      }

      // Also delete StaffProfile records to remove them from the dashboard
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: targetEmail });
      if (staffProfiles && staffProfiles.length > 0) {
        for (const profile of staffProfiles) {
          await base44.asServiceRole.entities.StaffProfile.delete(profile.id);
          console.log(`✅ Deleted StaffProfile record: ${profile.id}`);
        }
      }
    } catch (error) {
      console.error(`Error deleting user/staff entity:`, error);
    }

    console.log(`✅ User account processing complete for: ${targetEmail}`);

    return Response.json({ 
      success: true, 
      message: `User account ${targetEmail} deleted successfully.` 
    });

  } catch (error) {
    console.error('❌ Delete user error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});