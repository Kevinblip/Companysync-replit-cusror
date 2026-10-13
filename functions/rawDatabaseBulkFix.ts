import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 RAW DATABASE BULK FIX starting for user:', user.email);

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

        // Function to update ALL records using raw query (bypasses SDK filtering)
        const updateAllViaRawQuery = async (entityName) => {
            try {
                console.log(`\n🔍 Processing ${entityName} with RAW database access...`);
                
                // Use the backend to call raw database operations
                const updateResponse = await base44.functions.invoke('updateAllCompanyIds', {
                    entityName: entityName,
                    companyId: companyId
                });
                
                const count = updateResponse.data?.updated || 0;
                console.log(`✅ ${entityName}: Updated ${count} records`);
                return count;
                
            } catch (error) {
                console.error(`❌ ${entityName} failed:`, error.message);
                return 0;
            }
        };

        // Update all entities
        console.log('\n🚀 Starting RAW database bulk update...\n');
        
        stats.leads = await updateAllViaRawQuery('Lead');
        stats.customers = await updateAllViaRawQuery('Customer');
        stats.invoices = await updateAllViaRawQuery('Invoice');
        stats.estimates = await updateAllViaRawQuery('Estimate');
        stats.proposals = await updateAllViaRawQuery('Proposal');
        stats.projects = await updateAllViaRawQuery('Project');
        stats.tasks = await updateAllViaRawQuery('Task');
        stats.payments = await updateAllViaRawQuery('Payment');
        stats.communications = await updateAllViaRawQuery('Communication');
        stats.calendarEvents = await updateAllViaRawQuery('CalendarEvent');
        stats.documents = await updateAllViaRawQuery('Document');

        const totalUpdated = Object.values(stats).reduce((sum, val) => sum + val, 0);
        
        console.log('\n✅ RAW DATABASE BULK FIX COMPLETE!');
        console.log('📊 Stats:', stats);
        console.log(`🎉 Total: ${totalUpdated} records`);

        return Response.json({
            success: true,
            company_name: myCompany.company_name,
            company_id: companyId,
            stats: stats,
            total_updated: totalUpdated,
            message: `Successfully updated all ${totalUpdated} records!`
        });

    } catch (error) {
        console.error('❌ Raw database bulk fix error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});