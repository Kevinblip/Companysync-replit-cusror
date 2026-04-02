import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

/**
 * ZAPIER WEBHOOK INTEGRATION
 * Use this as a fallback for calendar/automation if Google Calendar has issues
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { type, payload } = body;

        console.log('📡 Zapier webhook triggered:', type);

        // Get company settings to find Zapier webhook URL
        const companies = await base44.asServiceRole.entities.Company.filter({ 
            created_by: user.email 
        });
        
        if (!companies || companies.length === 0) {
            return Response.json({ error: 'No company found' }, { status: 400 });
        }

        const company = companies[0];
        const zapierWebhookUrl = company.settings?.zapier_webhook_url;

        if (!zapierWebhookUrl) {
            return Response.json({ 
                error: 'Zapier webhook URL not configured. Add it in Company Setup.' 
            }, { status: 400 });
        }

        // Send to Zapier
        const zapierResponse = await fetch(zapierWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type,
                payload,
                user: {
                    email: user.email,
                    name: user.full_name
                },
                company_name: company.company_name,
                timestamp: new Date().toISOString()
            })
        });

        if (!zapierResponse.ok) {
            throw new Error(`Zapier webhook failed: ${zapierResponse.statusText}`);
        }

        console.log('✅ Successfully sent to Zapier');

        return Response.json({
            success: true,
            message: 'Sent to Zapier successfully'
        });

    } catch (error) {
        console.error('❌ Zapier webhook error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});