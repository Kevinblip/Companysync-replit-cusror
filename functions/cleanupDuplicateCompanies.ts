import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { targetCompanyId, dryRun = true } = await req.json();

    console.log('🧹 Starting Company Cleanup');
    console.log('Target Company ID:', targetCompanyId);
    console.log('Dry Run:', dryRun);

    // Get all companies
    const allCompanies = await base44.asServiceRole.entities.Company.list('-created_date', 100);
    console.log(`Found ${allCompanies.length} companies`);

    const targetCompany = allCompanies.find(c => c.id === targetCompanyId);
    if (!targetCompany) {
      return Response.json({ error: 'Target company not found' }, { status: 400 });
    }

    const companiesToDelete = allCompanies.filter(c => c.id !== targetCompanyId);
    console.log(`Will delete ${companiesToDelete.length} companies`);

    // Get all staff profiles
    const allStaff = await base44.asServiceRole.entities.StaffProfile.list('-created_date', 1000);
    console.log(`Found ${allStaff.length} total staff profiles`);

    // Find duplicates - same email, different company_id
    const staffByEmail = {};
    allStaff.forEach(staff => {
      const email = staff.user_email;
      if (!staffByEmail[email]) {
        staffByEmail[email] = [];
      }
      staffByEmail[email].push(staff);
    });

    const duplicateStaff = [];
    const staffToKeep = [];
    const staffToDelete = [];

    Object.entries(staffByEmail).forEach(([email, profiles]) => {
      if (profiles.length > 1) {
        duplicateStaff.push({ email, count: profiles.length, profiles });
        
        // Keep the one in target company, delete others
        const targetProfile = profiles.find(p => p.company_id === targetCompanyId);
        if (targetProfile) {
          staffToKeep.push(targetProfile);
          staffToDelete.push(...profiles.filter(p => p.id !== targetProfile.id));
        } else {
          // If none in target company, keep most recent and delete others
          const sorted = profiles.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
          staffToKeep.push(sorted[0]);
          staffToDelete.push(...sorted.slice(1));
        }
      } else {
        // Single profile - keep if in target company, otherwise delete
        if (profiles[0].company_id === targetCompanyId) {
          staffToKeep.push(profiles[0]);
        } else {
          staffToDelete.push(profiles[0]);
        }
      }
    });

    console.log(`Duplicate staff members: ${duplicateStaff.length}`);
    console.log(`Staff to keep: ${staffToKeep.length}`);
    console.log(`Staff to delete: ${staffToDelete.length}`);

    const report = {
      target_company: {
        id: targetCompany.id,
        name: targetCompany.company_name
      },
      companies_to_delete: companiesToDelete.map(c => ({
        id: c.id,
        name: c.company_name,
        created_by: c.created_by
      })),
      duplicate_staff: duplicateStaff.map(d => ({
        email: d.email,
        duplicate_count: d.count,
        profiles: d.profiles.map(p => ({
          id: p.id,
          company_id: p.company_id,
          full_name: p.full_name,
          in_target_company: p.company_id === targetCompanyId
        }))
      })),
      staff_to_delete: staffToDelete.map(s => ({
        id: s.id,
        email: s.user_email,
        full_name: s.full_name,
        company_id: s.company_id
      })),
      staff_to_keep: staffToKeep.map(s => ({
        id: s.id,
        email: s.user_email,
        full_name: s.full_name,
        company_id: s.company_id
      })),
      dry_run: dryRun
    };

    // If not dry run, execute deletions
    if (!dryRun) {
      console.log('🔥 EXECUTING DELETIONS...');

      // Delete duplicate staff profiles
      for (const staff of staffToDelete) {
        console.log(`Deleting staff: ${staff.full_name} (${staff.id})`);
        await base44.asServiceRole.entities.StaffProfile.delete(staff.id);
      }

      // Delete companies
      for (const company of companiesToDelete) {
        console.log(`Deleting company: ${company.company_name} (${company.id})`);
        await base44.asServiceRole.entities.Company.delete(company.id);
      }

      report.executed = true;
      report.deleted_staff_count = staffToDelete.length;
      report.deleted_companies_count = companiesToDelete.length;

      console.log('✅ Cleanup complete!');
    } else {
      console.log('ℹ️ DRY RUN - No changes made');
      report.executed = false;
    }

    return Response.json(report);

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});