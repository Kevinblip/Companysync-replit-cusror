import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { email } = await req.json();
        
        const testLead = {
            id: 'test-123',
            name: 'John Smith',
            phone: '+1 (555) 987-6543',
            email: 'johnsmith@example.com',
            street: '123 Storm Damage Lane',
            city: 'Columbus',
            state: 'OH',
            zip: '43215',
            source: 'storm_tracker',
            lead_source: 'Hail Storm - Franklin County Jan 2026',
            assigned_to: 'salesrep@company.com',
            notes: 'Homeowner reported visible roof damage after recent hail storm. Interested in free inspection.',
            created_date: new Date(Date.now() - 6 * 60 * 1000).toISOString() // 6 mins ago
        };
        
        const leadProfileUrl = `${Deno.env.get('APP_URL') || 'https://getcompanysync.com'}/lead-profile?id=${testLead.id}`;
        const assignedToText = testLead.assigned_to || 'Unassigned';
        
        const emailBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 2px solid #dc2626; border-radius: 8px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #dc2626, #ef4444); color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">🚨 LEAD ESCALATION ALERT</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Lead sitting in 'New' status for over 5 minutes</p>
    </div>
    
    <div style="padding: 30px 20px;">
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin-bottom: 20px;">
            <h2 style="margin: 0 0 10px 0; color: #dc2626; font-size: 18px;">Lead: ${testLead.name}</h2>
            <p style="margin: 0; color: #7f1d1d; font-size: 14px;">Created: ${new Date(testLead.created_date).toLocaleString()}</p>
        </div>

        <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; color: #374151; font-size: 16px;">📋 Lead Details</h3>
            
            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Contact Information:</strong>
                <p style="margin: 0; color: #111827;">
                    ${testLead.phone ? `📞 Phone: <a href="tel:${testLead.phone}" style="color: #2563eb;">${testLead.phone}</a>` : '📞 Phone: Not provided'}<br/>
                    ${testLead.email ? `📧 Email: <a href="mailto:${testLead.email}" style="color: #2563eb;">${testLead.email}</a>` : '📧 Email: Not provided'}
                </p>
            </div>

            ${testLead.street || testLead.city ? `
            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Property Address:</strong>
                <p style="margin: 0; color: #111827;">
                    📍 ${testLead.street || ''} ${testLead.city || ''}, ${testLead.state || ''} ${testLead.zip || ''}
                </p>
            </div>
            ` : ''}

            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Lead Source:</strong>
                <p style="margin: 0; color: #111827;">🎯 ${testLead.source || 'Unknown'}${testLead.lead_source ? ` - ${testLead.lead_source}` : ''}</p>
            </div>

            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Assigned To:</strong>
                <p style="margin: 0; color: #111827;">👤 ${assignedToText}</p>
            </div>

            ${testLead.notes ? `
            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Notes:</strong>
                <p style="margin: 0; color: #111827; font-style: italic;">${testLead.notes}</p>
            </div>
            ` : ''}
        </div>

        <div style="text-align: center; margin: 30px 0 20px 0;">
            <a href="${leadProfileUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb, #3b82f6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.3);">
                🔍 View Lead Profile
            </a>
        </div>

        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin-top: 20px;">
            <p style="margin: 0; color: #78350f; font-size: 13px;">
                <strong>⚠️ Speed-to-Lead Alert:</strong> Research shows that responding within 5 minutes increases conversion by 900%. Contact this lead immediately.
            </p>
        </div>
    </div>

    <div style="background: #f9fafb; padding: 15px 20px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #6b7280; font-size: 12px;">
            CompanySync CRM | Lead Escalation Watchdog<br/>
            <a href="${leadProfileUrl}" style="color: #2563eb; text-decoration: none;">Unsubscribe from escalation alerts</a>
        </p>
    </div>
</div>
        `.trim();
        
        await base44.integrations.Core.SendEmail({
            to: email,
            subject: `🚨 ESCALATION: Lead ${testLead.name} ignored for 5+ minutes`,
            body: emailBody
        });

        return Response.json({ success: true, message: `Test email sent to ${email}` });

    } catch (error) {
        console.error("Error sending test email:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});