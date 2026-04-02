import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔍 Lexi Diagnostic - User:', user.email);

        // Get user's company
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        let myCompany = companies[0];

        if (!myCompany) {
            console.log('⚠️ No company found owned by user, checking staff profile...');
            const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
            if (staffProfiles[0]) {
                const companyId = staffProfiles[0].company_id;
                console.log('✅ Found company via staff profile:', companyId);
                const companyList = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                myCompany = companyList[0];
            }
        }

        if (!myCompany) {
            return Response.json({ 
                error: 'No company found',
                user_email: user.email,
                companies_checked: companies.length
            }, { status: 404 });
        }

        const companyId = myCompany.id;
        console.log(`✅ Company: ${myCompany.company_name} (${companyId})`);

        // Now test queries the same way Lexi does
        const diagnostic = {
            user_email: user.email,
            company_id: companyId,
            company_name: myCompany.company_name,
            queries: {}
        };

        // Test payments with DETAILED logging
        console.log('\n💰 Testing Payment queries...');
        
        // Get ALL payments (no filter)
        const allPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 100);
        console.log(`Found ${allPayments.length} total payments in system`);
        
        // Show company_id distribution (anonymized for user display)
        const companyIdCounts = {};
        const companyIdMap = {}; // Map real IDs to friendly names
        let idCounter = 1;
        
        allPayments.forEach(p => {
            const cid = p.company_id || 'NULL';
            if (!companyIdMap[cid]) {
                companyIdMap[cid] = cid === 'NULL' ? 'Missing' : (cid === companyId ? 'Your Company' : `Other Company ${idCounter++}`);
            }
            const friendlyName = companyIdMap[cid];
            companyIdCounts[friendlyName] = (companyIdCounts[friendlyName] || 0) + 1;
        });
        console.log('Company ID distribution:', companyIdCounts);
        
        // Now test with filter (what Lexi uses)
        const filteredPayments = await base44.asServiceRole.entities.Payment.filter({ company_id: companyId });
        console.log(`Found ${filteredPayments.length} payments with company_id filter`);
        
        // Check for data integrity issues
        const issueCount = allPayments.length - filteredPayments.length;
        const hasIssues = issueCount > 0;
        
        diagnostic.queries.payments = {
            total_in_system: allPayments.length,
            correctly_tagged: filteredPayments.length,
            company_distribution: companyIdCounts,
            has_data_issues: hasIssues,
            issue_summary: hasIssues ? `${issueCount} payments found with incorrect or missing company tags` : 'All payments correctly tagged'
        };

        // Test customer query
        console.log('\n📊 Testing Customer query...');
        const customers = await base44.asServiceRole.entities.Customer.filter({ company_id: companyId });
        diagnostic.queries.customers = {
            with_filter: customers.length
        };

        // Test leads
        console.log('📊 Testing Lead query...');
        const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId });
        diagnostic.queries.leads = {
            with_filter: leads.length
        };

        // Test invoices
        console.log('📊 Testing Invoice query...');
        const invoices = await base44.asServiceRole.entities.Invoice.filter({ company_id: companyId });
        diagnostic.queries.invoices = {
            with_filter: invoices.length
        };

        // Test tasks
        console.log('📊 Testing Task query...');
        const tasks = await base44.asServiceRole.entities.Task.filter({ company_id: companyId });
        diagnostic.queries.tasks = {
            with_filter: tasks.length
        };

        return Response.json({
            success: true,
            diagnostic: diagnostic
        });

    } catch (error) {
        console.error('❌ Diagnostic error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});