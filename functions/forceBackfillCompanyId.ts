import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 BULK FIX starting for user:', user.email);

        // Get user's company
        const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        let myCompany = companies[0];

        if (!myCompany) {
            const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
            if (staffProfiles[0]) {
                const allCompanies = await base44.asServiceRole.entities.Company.filter({ id: staffProfiles[0].company_id });
                myCompany = allCompanies[0];
            }
        }

        if (!myCompany) {
            return Response.json({ 
                success: false,
                error: 'Company not found' 
            }, { status: 404 });
        }

        const companyId = myCompany.id;
        console.log('🏢 Company:', myCompany.company_name, 'ID:', companyId);

        const stats = {};

        // NUCLEAR OPTION: Update ALL records using pagination to catch EVERYTHING
        const updateAllRecordsComplete = async (entityName) => {
            try {
                console.log(`\n🔄 Processing ${entityName}...`);
                
                let allRecords = [];
                let hasMore = true;
                let skip = 0;
                const limit = 1000; // Fetch in chunks of 1000
                
                // Keep fetching until we have everything
                while (hasMore) {
                    console.log(`   Fetching ${entityName} ${skip} to ${skip + limit}...`);
                    
                    // Fetch WITHOUT company_id filter to get EVERYTHING
                    const batch = await base44.asServiceRole.entities[entityName].list('-created_date', limit);
                    
                    if (batch.length === 0) {
                        hasMore = false;
                    } else {
                        allRecords = allRecords.concat(batch);
                        skip += limit;
                        
                        // If we got less than limit, we're done
                        if (batch.length < limit) {
                            hasMore = false;
                        }
                    }
                }
                
                console.log(`📦 Found ${allRecords.length} total ${entityName} records`);

                if (allRecords.length === 0) {
                    return 0;
                }

                // Update in parallel batches of 100
                let updated = 0;
                const batchSize = 100;
                
                for (let i = 0; i < allRecords.length; i += batchSize) {
                    const batch = allRecords.slice(i, i + batchSize);
                    console.log(`   Updating batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allRecords.length/batchSize)}...`);
                    
                    const promises = batch.map(record => 
                        base44.asServiceRole.entities[entityName].update(record.id, { 
                            company_id: companyId 
                        }).catch(err => {
                            console.error(`   ❌ Failed ${entityName} ${record.id}:`, err.message);
                            return null;
                        })
                    );
                    
                    const results = await Promise.all(promises);
                    updated += results.filter(r => r !== null).length;
                }
                
                console.log(`✅ ${entityName}: Updated ${updated}/${allRecords.length} records`);
                return updated;
                
            } catch (error) {
                console.error(`❌ ${entityName} failed:`, error.message);
                return 0;
            }
        };

        // Update ALL entity types
        console.log('\n🚀 Starting bulk update of ALL entities...\n');
        
        stats.leads = await updateAllRecordsComplete('Lead');
        stats.customers = await updateAllRecordsComplete('Customer');
        stats.invoices = await updateAllRecordsComplete('Invoice');
        stats.estimates = await updateAllRecordsComplete('Estimate');
        stats.proposals = await updateAllRecordsComplete('Proposal');
        stats.projects = await updateAllRecordsComplete('Project');
        stats.tasks = await updateAllRecordsComplete('Task');
        stats.payments = await updateAllRecordsComplete('Payment');
        stats.communications = await updateAllRecordsComplete('Communication');
        stats.calendarEvents = await updateAllRecordsComplete('CalendarEvent');
        stats.documents = await updateAllRecordsComplete('Document');

        const totalUpdated = Object.values(stats).reduce((sum, val) => sum + val, 0);
        
        console.log('\n✅ BULK FIX COMPLETE!');
        console.log('📊 Final stats:', stats);
        console.log(`🎉 Total updated: ${totalUpdated} records`);

        return Response.json({
            success: true,
            company_name: myCompany.company_name,
            company_id: companyId,
            stats: stats,
            total_updated: totalUpdated,
            message: `Successfully updated all ${totalUpdated} records with your company ID!`
        });

    } catch (error) {
        console.error('❌ Bulk fix error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});