import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { company_id } = await req.json();

        if (!company_id) {
            return Response.json({ error: 'Company ID is required' }, { status: 400 });
        }

        // Fetch data in parallel
        const [leads, customers] = await Promise.all([
            base44.asServiceRole.entities.Lead.filter({ company_id }, '-created_date', 10000),
            base44.asServiceRole.entities.Customer.filter({ company_id }, '-created_date', 10000)
        ]);

        const warnings = [];
        
        // Build Lookup Maps for Customers (O(M))
        const customerEmailMap = new Map();
        const customerPhoneMap = new Map();
        const customerNameMap = new Map();

        const normalize = (str) => str ? str.toLowerCase().trim() : '';
        const normalizePhone = (str) => str ? str.replace(/\D/g, '') : '';

        customers.forEach(c => {
            if (c.email) {
                const email = normalize(c.email);
                if (email) {
                    if (!customerEmailMap.has(email)) customerEmailMap.set(email, []);
                    customerEmailMap.get(email).push(c);
                }
            }
            
            [c.phone, c.phone_2].forEach(p => {
                const phone = normalizePhone(p);
                if (phone.length >= 7) { // Min length to avoid matching short/empty
                    if (!customerPhoneMap.has(phone)) customerPhoneMap.set(phone, []);
                    customerPhoneMap.get(phone).push(c);
                }
            });

            if (c.name) {
                const name = normalize(c.name);
                if (name) {
                    if (!customerNameMap.has(name)) customerNameMap.set(name, []);
                    customerNameMap.get(name).push(c);
                }
            }
        });

        // Check Leads against Maps (O(N))
        leads.forEach(lead => {
            const matches = new Set(); // Use Set to store unique matched customers

            // Check Name
            const name = normalize(lead.name);
            if (name && customerNameMap.has(name)) {
                customerNameMap.get(name).forEach(c => matches.add(c));
            }

            // Check Email
            const email = normalize(lead.email);
            if (email && customerEmailMap.has(email)) {
                customerEmailMap.get(email).forEach(c => matches.add(c));
            }

            // Check Phones
            [lead.phone, lead.phone_2].forEach(p => {
                const phone = normalizePhone(p);
                if (phone.length >= 7 && customerPhoneMap.has(phone)) {
                    customerPhoneMap.get(phone).forEach(c => matches.add(c));
                }
            });

            if (matches.size > 0) {
                const matchingCustomers = Array.from(matches);
                warnings.push({
                    leadId: lead.id,
                    leadName: lead.name,
                    matchType: matchingCustomers.some(c => normalize(c.name) === name) ? 'name' : 'contact',
                    customerNames: matchingCustomers.map(c => c.name).join(', ')
                });
            }
        });

        return Response.json({ warnings });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});