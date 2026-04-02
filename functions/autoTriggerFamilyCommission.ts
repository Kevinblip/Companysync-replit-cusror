import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This function is triggered by database mutations
        const { entityName, action, data, oldData } = await req.json();

        console.log('🔔 Auto-trigger check:', entityName, action);

        // Only trigger on Payment received
        if (entityName === 'Payment' && action === 'create' && data.status === 'received') {
            console.log('💰 Payment received, triggering family commission');
            
            // Call the distribution function
            const baseUrl = new URL(req.url).origin;
            const response = await fetch(`${baseUrl}/api/functions/distributeFamilyCommission`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.get('Authorization')
                },
                body: JSON.stringify({
                    payment_id: data.id,
                    company_id: data.company_id
                })
            });

            const result = await response.json();
            console.log('✅ Commission distribution result:', result);
            
            return Response.json({ 
                success: true, 
                triggered: 'family_commission',
                result: result 
            });
        }

        return Response.json({ success: true, triggered: false });

    } catch (error) {
        console.error('❌ Auto-trigger error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});