import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔍 Finding user company...');
        
        // Get user's company
        const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        let myCompany = companies[0];

        // If no company owned by user, check if they're staff
        if (!myCompany) {
            const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
            if (staffProfiles[0]) {
                const companyId = staffProfiles[0].company_id;
                const companyList = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                myCompany = companyList[0];
            }
        }

        if (!myCompany) {
            return Response.json({ error: 'No company found for user' }, { status: 404 });
        }

        const companyId = myCompany.id;
        console.log(`✅ Company: ${myCompany.company_name} (${companyId})`);

        const updated = {};

        // Entity types to update
        const entityTypes = [
            'Lead',
            'Customer', 
            'Task',
            'Invoice',
            'Estimate',
            'Project',
            'Payment',
            'CalendarEvent',
            'Proposal',
            'Communication'
        ];

        for (const entityType of entityTypes) {
            try {
                console.log(`\n📊 Processing ${entityType}...`);
                
                // Get ALL records for this entity (up to 10000)
                const allRecords = await base44.asServiceRole.entities[entityType].list('-created_date', 10000);
                console.log(`   Found ${allRecords.length} total records`);
                
                // Filter to only records WITHOUT company_id
                const recordsToUpdate = allRecords.filter(record => !record.company_id);
                console.log(`   ${recordsToUpdate.length} records missing company_id`);
                
                if (recordsToUpdate.length === 0) {
                    console.log(`   ✅ All ${entityType} records already have company_id`);
                    updated[entityType] = 0;
                    continue;
                }

                // Update each record
                let updateCount = 0;
                for (const record of recordsToUpdate) {
                    try {
                        await base44.asServiceRole.entities[entityType].update(record.id, {
                            company_id: companyId
                        });
                        updateCount++;
                        
                        if (updateCount % 10 === 0) {
                            console.log(`   Updated ${updateCount}/${recordsToUpdate.length}...`);
                        }
                    } catch (updateError) {
                        console.error(`   ❌ Failed to update ${entityType} ${record.id}:`, updateError.message);
                    }
                }
                
                updated[entityType] = updateCount;
                console.log(`   ✅ Updated ${updateCount} ${entityType} records`);

            } catch (error) {
                console.error(`❌ Error processing ${entityType}:`, error.message);
                updated[entityType] = 0;
            }
        }

        const totalUpdated = Object.values(updated).reduce((sum, count) => sum + count, 0);
        
        console.log('\n✅ Populate complete!');
        console.log('Summary:', updated);

        return Response.json({
            success: true,
            message: `Successfully populated company_id for ${totalUpdated} records`,
            updated: updated,
            company_id: companyId,
            company_name: myCompany.company_name
        });

    } catch (error) {
        console.error('❌ Fatal error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});