import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting address cleanup...');

        // Get all customers and leads
        const customers = await base44.asServiceRole.entities.Customer.list('', 10000);
        const leads = await base44.asServiceRole.entities.Lead.list('', 10000);

        let fixedCount = 0;
        let incompleteCount = 0;
        const incompleteRecords = [];

        // Fix customers
        for (const customer of customers) {
            const hasStreet = customer.street && customer.street.trim() !== '';
            const hasCity = customer.city && customer.city.trim() !== '';
            const hasState = customer.state && customer.state.trim() !== '';
            const hasZip = customer.zip && customer.zip.trim() !== '';
            const hasLegacyAddress = customer.address && customer.address.trim() !== '';

            // If has street/city/state/zip but no combined address, rebuild it
            if ((hasStreet || hasCity || hasState || hasZip) && !hasLegacyAddress) {
                const parts = [customer.street, customer.city, customer.state, customer.zip].filter(Boolean);
                const fullAddress = parts.join(', ');
                
                try {
                    await base44.asServiceRole.entities.Customer.update(customer.id, {
                        address: fullAddress
                    });
                    fixedCount++;
                    console.log(`✅ Fixed customer address: ${customer.name}`);
                } catch (error) {
                    console.error(`❌ Failed to fix customer ${customer.id}:`, error);
                }
            }
            // If has legacy address but no individual fields, flag as incomplete
            else if (hasLegacyAddress && !hasStreet && !hasCity && !hasState && !hasZip) {
                incompleteCount++;
                incompleteRecords.push({
                    type: 'Customer',
                    id: customer.id,
                    name: customer.name,
                    address: customer.address,
                    issue: 'Has combined address but missing street/city/state/zip breakdown'
                });
            }
            // If no address data at all, flag as incomplete
            else if (!hasStreet && !hasCity && !hasState && !hasZip && !hasLegacyAddress) {
                incompleteCount++;
                incompleteRecords.push({
                    type: 'Customer',
                    id: customer.id,
                    name: customer.name,
                    issue: 'No address data'
                });
            }
        }

        // Fix leads
        for (const lead of leads) {
            const hasStreet = lead.street && lead.street.trim() !== '';
            const hasCity = lead.city && lead.city.trim() !== '';
            const hasState = lead.state && lead.state.trim() !== '';
            const hasZip = lead.zip && lead.zip.trim() !== '';

            // If missing any address component, flag as incomplete
            if (!hasStreet || !hasCity || !hasState || !hasZip) {
                if (hasStreet || hasCity || hasState || hasZip) {
                    incompleteCount++;
                    incompleteRecords.push({
                        type: 'Lead',
                        id: lead.id,
                        name: lead.name,
                        current: {
                            street: lead.street || '',
                            city: lead.city || '',
                            state: lead.state || '',
                            zip: lead.zip || ''
                        },
                        issue: 'Partial address - missing some components'
                    });
                }
            }
        }

        const summary = {
            customers_processed: customers.length,
            leads_processed: leads.length,
            addresses_fixed: fixedCount,
            incomplete_records_found: incompleteCount,
            incomplete_records: incompleteRecords.slice(0, 50) // First 50
        };

        console.log('✅ Address cleanup complete:', summary);

        return Response.json({
            success: true,
            summary
        });

    } catch (error) {
        console.error('❌ Address cleanup error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});