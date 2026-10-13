import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔍 Checking company_id status...');

        // Get user's company
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        let myCompany = companies[0];

        if (!myCompany) {
            const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
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

        const status = {
            company_id: companyId,
            company_name: myCompany.company_name,
            entities: {}
        };

        // Check each entity type
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
                console.log(`\n📊 Checking ${entityType}...`);
                
                // Get ALL records
                const allRecords = await base44.asServiceRole.entities[entityType].list('-created_date', 10000);
                
                // Count records with and without company_id
                const withCompanyId = allRecords.filter(r => r.company_id === companyId);
                const withoutCompanyId = allRecords.filter(r => !r.company_id);
                const otherCompany = allRecords.filter(r => r.company_id && r.company_id !== companyId);
                
                status.entities[entityType] = {
                    total: allRecords.length,
                    with_your_company_id: withCompanyId.length,
                    without_company_id: withoutCompanyId.length,
                    other_company: otherCompany.length,
                    sample_records: withCompanyId.slice(0, 3).map(r => ({
                        id: r.id,
                        name: r.name || r.customer_name || r.title || r.invoice_number || 'N/A',
                        company_id: r.company_id,
                        created_date: r.created_date
                    }))
                };

                console.log(`   Total: ${allRecords.length}`);
                console.log(`   ✅ With your company_id: ${withCompanyId.length}`);
                console.log(`   ❌ Without company_id: ${withoutCompanyId.length}`);
                console.log(`   🏢 Other company: ${otherCompany.length}`);

            } catch (error) {
                console.error(`❌ Error checking ${entityType}:`, error.message);
                status.entities[entityType] = {
                    error: error.message
                };
            }
        }

        console.log('\n✅ Status check complete');

        return Response.json({
            success: true,
            ...status
        });

    } catch (error) {
        console.error('❌ Fatal error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});