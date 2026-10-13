import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

export default Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { target = 'all', entityName, sortOrder = '-created_date' } = await req.json().catch(() => ({}));
    
    const report = {
        fixed_users: [],
        fixed_records: {},
        deleted_records: {}
    };

    // 1. Get all valid companies (needed for both checks)
    // Using limit 1000 to be safe, assuming < 1000 companies
    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1000);
    const validCompanyIds = new Set(companies.map(c => c.id));

    // ==========================================
    // FIX 1: Multi-Tenant Users
    // ==========================================
    if (target === 'all' || target === 'users') {
        const allStaff = await base44.asServiceRole.entities.StaffProfile.list('-created_date', 5000);
        const staffByEmail = {};
        
        for (const staff of allStaff) {
            if (!staff.user_email) continue;
            if (!staffByEmail[staff.user_email]) staffByEmail[staff.user_email] = [];
            staffByEmail[staff.user_email].push(staff);
        }

        for (const [email, profiles] of Object.entries(staffByEmail)) {
            if (profiles.length > 1) {
                // Sort profiles to find the best one to keep
                profiles.sort((a, b) => {
                    // Priority 0: Valid Company (Active companies first)
                    const isAValid = validCompanyIds.has(a.company_id);
                    const isBValid = validCompanyIds.has(b.company_id);
                    if (isAValid !== isBValid) return isAValid ? -1 : 1;

                    // Priority 1: Super Admin / Admin
                    if (a.is_super_admin !== b.is_super_admin) return b.is_super_admin ? 1 : -1;
                    if (a.is_administrator !== b.is_administrator) return b.is_administrator ? 1 : -1;
                    
                    // Priority 2: Last Login (Newest first)
                    const dateA = a.last_login ? new Date(a.last_login).getTime() : 0;
                    const dateB = b.last_login ? new Date(b.last_login).getTime() : 0;
                    if (dateA !== dateB) return dateB - dateA;

                    // Priority 3: Creation Date (Newest first)
                    const createdA = a.created_date ? new Date(a.created_date).getTime() : 0;
                    const createdB = b.created_date ? new Date(b.created_date).getTime() : 0;
                    return createdB - createdA;
                });

                const toKeep = profiles[0];
                const toDelete = profiles.slice(1);

                for (const profile of toDelete) {
                    await base44.asServiceRole.entities.StaffProfile.delete(profile.id);
                }

                report.fixed_users.push({
                    email,
                    kept_company: toKeep.company_id,
                    removed_count: toDelete.length
                });
            }
        }
    }

    // ==========================================
    // FIX 2: Orphaned Records
    // ==========================================
    if (target === 'all' || target === 'records') {
        const entitiesToCheck = entityName ? [entityName] : [
            'Customer', 'Lead', 'Invoice', 'Estimate', 
            'Task', 'CalendarEvent', 'Communication', 'Project'
        ];

        // Cache user -> company map for repair
        const freshStaff = await base44.asServiceRole.entities.StaffProfile.list('-created_date', 5000);
        const userCompanyMap = {};
        for (const s of freshStaff) {
            if (s.user_email && s.company_id && validCompanyIds.has(s.company_id)) {
                userCompanyMap[s.user_email] = s.company_id;
            }
        }

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const entity of entitiesToCheck) {
            // Strategy 1: Target explicitly missing IDs first (usually the bulk of the problem)
            // We'll process these in small batches
            let missingIdRecords = [];
            try {
                // Try to find records with null company_id
                missingIdRecords = await base44.asServiceRole.entities[entity].filter({ company_id: null }, sortOrder, 50);
            } catch (e) {
                // If filter fails, fall back to list
                console.log(`Filter by null failed for ${entity}, falling back to list`);
            }

            // Strategy 2: If no missing IDs found, fetch records based on sort order to check for invalid IDs
            // We limit to 100 to avoid timeouts
            let records = missingIdRecords.length > 0 ? missingIdRecords : await base44.asServiceRole.entities[entity].list(sortOrder, 100);
            
            let fixed = 0;
            let deleted = 0;
            let processed = 0;

            for (const record of records) {
                // Check if company_id is valid (exists AND is in the list of valid companies)
                const isValid = record.company_id && validCompanyIds.has(record.company_id);
                
                if (!isValid) {
                    try {
                        // Attempt Repair
                        const ownerCompanyId = userCompanyMap[record.created_by];
                        
                        if (ownerCompanyId) {
                            await base44.asServiceRole.entities[entity].update(record.id, {
                                company_id: ownerCompanyId
                            });
                            fixed++;
                        } else {
                            // Impossible to repair -> Delete
                            await base44.asServiceRole.entities[entity].delete(record.id);
                            deleted++;
                        }
                    } catch (err) {
                        console.error(`Failed to process record ${record.id} in ${entity}: ${err.message}`);
                    }
                    
                    // Throttle: Increased to 500ms to strictly avoid rate limits
                    await sleep(500);
                }
                processed++;
            }

            if (fixed > 0) report.fixed_records[entity] = fixed;
            if (deleted > 0) report.deleted_records[entity] = deleted;
        }
    }

    return Response.json({ success: true, report });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});