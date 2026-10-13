import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { records, company_id } = await req.json();

    if (!records || !Array.isArray(records) || !company_id) {
      return Response.json({ error: 'Invalid request: records array and company_id are required.' }, { status: 400 });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errorDetails = [];

    await Promise.all(records.map(async (record, index) => {
      const rowNum = index + 2; // +1 for 0-based index, +1 for header row
      try {
        if (!record.email || !record.full_name) {
          throw new Error("Missing required fields: email and full_name");
        }

        const existingUser = await base44.asServiceRole.entities.User.filter({ email: record.email });

        let userId;
        let isNewUser = false;

        if (existingUser.length > 0) {
          // User exists, update them
          userId = existingUser[0].id;
          await base44.asServiceRole.entities.User.update(userId, {
            full_name: record.full_name,
            role: record.role || 'user',
          });
        } else {
          // User does not exist, create them
          isNewUser = true;
          if (!record.temporary_password) {
            throw new Error("Missing temporary_password for new user.");
          }
          const newUser = await base44.asServiceRole.entities.User.create({
            email: record.email,
            full_name: record.full_name,
            password: record.temporary_password,
            role: record.role || 'user',
          });
          userId = newUser.id;
        }

        // Now, create or update StaffProfile
        const existingProfile = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: record.email });

        const profilePayload = {
          company_id: company_id,
          user_email: record.email,
          position: record.position,
          phone: record.phone,
          hourly_rate: parseFloat(record.hourly_rate) || 0,
          is_active: true,
        };

        if (existingProfile.length > 0) {
          await base44.asServiceRole.entities.StaffProfile.update(existingProfile[0].id, profilePayload);
          if (!isNewUser) updatedCount++;
        } else {
          await base44.asServiceRole.entities.StaffProfile.create(profilePayload);
        }

        if (isNewUser) {
            createdCount++;
        }

      } catch (e) {
        errorCount++;
        errorDetails.push({ row: rowNum, reason: e.message, data: record });
      }
    }));

    return Response.json({
      success: errorCount === 0,
      created: createdCount,
      updated: updatedCount,
      errors: errorCount,
      errorDetails: errorDetails,
    });

  } catch (error) {
    return Response.json({ error: error.message, errorDetails: [] }, { status: 500 });
  }
});