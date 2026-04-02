import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Define time threshold
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        // Fetch leads: 'new', active, and created recently (limit 50 to avoid timeout)
        // We'll filter for !tags.includes('Escalated') in memory if needed, 
        // but let's try to grab a batch and process efficiently.
        const leads = await base44.asServiceRole.entities.Lead.filter(
            { status: 'new', is_active: true }, 
            '-created_date', 
            50
        );

        if (!leads.length) return Response.json({ success: true, count: 0 });

        // Group leads by company_id to fetch admins efficiently
        const leadsByCompany = {};
        for (const lead of leads) {
            // Check if created > 5 mins ago
            if (new Date(lead.created_date) >= fiveMinutesAgo) continue;
            
            // Check if already escalated
            if (lead.tags && lead.tags.includes('Escalated')) continue;
            
            // Check if contacted
            if (lead.last_contact_date) continue;

            if (!leadsByCompany[lead.company_id]) {
                leadsByCompany[lead.company_id] = [];
            }
            leadsByCompany[lead.company_id].push(lead);
        }

        // Process each company
        const companyIds = Object.keys(leadsByCompany);
        
        await Promise.all(companyIds.map(async (companyId) => {
            const companyLeads = leadsByCompany[companyId];
            if (!companyLeads.length) return;

            // Fetch admins for this company ONCE
            const admins = await base44.asServiceRole.entities.StaffProfile.filter({
                company_id: companyId,
                is_administrator: true
            });
            const adminEmails = admins.map(a => a.user_email);

            // Process leads for this company in parallel
            await Promise.all(companyLeads.map(async (lead) => {
                console.log(`Escalating lead ${lead.id}`);

                try {
                    // 1. Create Task
                    await base44.asServiceRole.entities.Task.create({
                        company_id: lead.company_id,
                        name: "Escalation - lead not contacted",
                        description: `Lead ${lead.name} has been new for >5 minutes without contact.`,
                        priority: "high",
                        status: "not_started",
                        assigned_to: lead.assigned_to,
                        assignees: lead.assigned_to ? [{email: lead.assigned_to}] : []
                    });

                    // 2. Notify Admins with FULL LEAD DETAILS
                    // Use Promise.all for multiple admins
                    if (adminEmails.length > 0) {
                        const leadProfileUrl = `${Deno.env.get('APP_URL')}/lead-profile?id=${lead.id}`;
                        const assignedToText = lead.assigned_to || 'Unassigned';
                        
                        const emailBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 2px solid #dc2626; border-radius: 8px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #dc2626, #ef4444); color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">🚨 LEAD ESCALATION ALERT</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Lead sitting in 'New' status for over 5 minutes</p>
    </div>
    
    <div style="padding: 30px 20px;">
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin-bottom: 20px;">
            <h2 style="margin: 0 0 10px 0; color: #dc2626; font-size: 18px;">Lead: ${lead.name}</h2>
            <p style="margin: 0; color: #7f1d1d; font-size: 14px;">Created: ${new Date(lead.created_date).toLocaleString()}</p>
        </div>

        <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; color: #374151; font-size: 16px;">📋 Lead Details</h3>
            
            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Contact Information:</strong>
                <p style="margin: 0; color: #111827;">
                    ${lead.phone ? `📞 Phone: <a href="tel:${lead.phone}" style="color: #2563eb;">${lead.phone}</a>` : '📞 Phone: Not provided'}<br/>
                    ${lead.email ? `📧 Email: <a href="mailto:${lead.email}" style="color: #2563eb;">${lead.email}</a>` : '📧 Email: Not provided'}
                </p>
            </div>

            ${lead.street || lead.city ? `
            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Property Address:</strong>
                <p style="margin: 0; color: #111827;">
                    📍 ${lead.street || ''} ${lead.city || ''}, ${lead.state || ''} ${lead.zip || ''}
                </p>
            </div>
            ` : ''}

            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Lead Source:</strong>
                <p style="margin: 0; color: #111827;">🎯 ${lead.source || 'Unknown'}</p>
            </div>

            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Assigned To:</strong>
                <p style="margin: 0; color: #111827;">👤 ${assignedToText}</p>
            </div>

            ${lead.notes ? `
            <div style="margin-bottom: 12px;">
                <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 4px;">Notes:</strong>
                <p style="margin: 0; color: #111827; font-style: italic;">${lead.notes}</p>
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
            <a href="${Deno.env.get('APP_URL')}/lead-profile?id=${lead.id}" style="color: #2563eb; text-decoration: none;">Unsubscribe from escalation alerts</a>
        </p>
    </div>
</div>
                        `.trim();
                        
                        await Promise.all(adminEmails.map(email => 
                            base44.integrations.Core.SendEmail({
                                to: email,
                                subject: `🚨 ESCALATION: Lead ${lead.name} ignored for 5+ minutes`,
                                body: emailBody
                            }).catch(err => console.error(`Failed to email admin ${email}`, err))
                        ));
                    }

                    // 3. Mark as Escalated
                    const currentTags = lead.tags || [];
                    await base44.asServiceRole.entities.Lead.update(lead.id, {
                        tags: [...currentTags, 'Escalated']
                    });
                } catch (err) {
                    console.error(`Error processing lead ${lead.id}:`, err);
                }
            }));
        }));

        return Response.json({ success: true });

    } catch (error) {
        console.error("Error in Escalation Watchdog:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});