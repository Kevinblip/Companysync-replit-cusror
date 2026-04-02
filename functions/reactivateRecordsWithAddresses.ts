import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's company
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        const myCompany = companies[0];

        if (!myCompany) {
            return Response.json({ error: 'No company found for this user' }, { status: 404 });
        }

        console.log('🏢 Company:', myCompany.company_name);

        // Fetch ALL leads and customers for this company using service role
        const allLeads = await base44.asServiceRole.entities.Lead.filter({ company_id: myCompany.id });
        const allCustomers = await base44.asServiceRole.entities.Customer.filter({ company_id: myCompany.id });

        console.log(`📊 Total leads: ${allLeads.length}, Total customers: ${allCustomers.length}`);

        let reactivatedLeads = 0;
        let reactivatedCustomers = 0;

        // Reactivate leads with addresses
        for (const lead of allLeads) {
            const hasAddress = (lead.street && lead.city && lead.state) || lead.address;
            
            if (hasAddress) {
                await base44.asServiceRole.entities.Lead.update(lead.id, { is_active: true });
                reactivatedLeads++;
            }
        }

        // Reactivate customers with addresses
        for (const customer of allCustomers) {
            const hasAddress = (customer.street && customer.city && customer.state) || customer.address;
            
            if (hasAddress) {
                await base44.asServiceRole.entities.Customer.update(customer.id, { is_active: true });
                reactivatedCustomers++;
            }
        }

        console.log(`✅ Reactivated ${reactivatedLeads} leads and ${reactivatedCustomers} customers`);

        return Response.json({
            success: true,
            message: `Successfully reactivated ${reactivatedLeads} leads and ${reactivatedCustomers} customers with valid addresses`,
            details: {
                reactivated_leads: reactivatedLeads,
                reactivated_customers: reactivatedCustomers,
                total_leads: allLeads.length,
                total_customers: allCustomers.length,
                leads_without_address: allLeads.length - reactivatedLeads,
                customers_without_address: allCustomers.length - reactivatedCustomers
            }
        });

    } catch (error) {
        console.error('❌ Reactivation Error:', error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});