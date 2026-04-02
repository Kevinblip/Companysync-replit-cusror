import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import twilio from 'npm:twilio';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { event, data } = await req.json();

        if (!data || !data.company_id) {
            return Response.json({ message: "No data or company_id" });
        }

        // Filter: status == "new", is_active == true, phone or email exists
        if (data.status !== 'new' || !data.is_active || (!data.phone && !data.email)) {
            return Response.json({ message: "Filter conditions not met" });
        }

        let assignedTo = data.assigned_to;
        let leadId = data.id;

        // 1) Assign lead owner (Round Robin)
        if (!assignedTo) {
            try {
                const rrResponse = await base44.functions.invoke('roundRobinAssign', {
                    companyId: data.company_id,
                    entityType: 'lead'
                });
                
                if (rrResponse.data && rrResponse.data.assigned) {
                    assignedTo = rrResponse.data.assignedToEmail;
                    // Update Lead
                    await base44.asServiceRole.entities.Lead.update(leadId, {
                        assigned_to: assignedTo,
                        assigned_to_users: [assignedTo]
                    });
                }
            } catch (e) {
                console.error("Round Robin failed:", e);
            }
        }

        // 2) Create Task
        if (assignedTo) {
            await base44.asServiceRole.entities.Task.create({
                company_id: data.company_id,
                name: "Call new lead in 5 minutes",
                description: "Speed to Lead - Shock and Awe",
                due_date: new Date().toISOString().split('T')[0], 
                assigned_to: assignedTo,
                assignees: [{ email: assignedTo }],
                related_to: data.name,
                source: "lead",
                status: "not_started",
                priority: "high"
            });
        }

        // 3) After 10 seconds: Send SMS
        await new Promise(resolve => setTimeout(resolve, 10000));

        if (data.phone) {
            let accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
            let authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
            let fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

            const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: data.company_id });
            if (twilioSettings.length > 0 && twilioSettings[0].account_sid) {
                const ts = twilioSettings[0];
                accountSid = ts.account_sid;
                authToken = ts.auth_token;
                fromNumber = ts.main_phone_number;
            } else {
                const intSettings = await base44.asServiceRole.entities.IntegrationSetting.filter({ 
                    company_id: data.company_id,
                    integration_name: 'Twilio',
                    is_enabled: true
                });
                if (intSettings.length > 0 && intSettings[0].config) {
                    const conf = intSettings[0].config;
                    if (conf.api_key) accountSid = conf.username; 
                }
            }

            // Ensure credentials are strings and trimmed
            accountSid = accountSid ? String(accountSid).trim() : null;
            authToken = authToken ? String(authToken).trim() : null;
            fromNumber = fromNumber ? String(fromNumber).trim() : null;

            if (accountSid && accountSid.startsWith('AC') && authToken && fromNumber) {
                try {
                    const client = twilio(accountSid, authToken);
                    const msg = await client.messages.create({
                        body: `Hi ${data.name}, thanks for your interest! We'll be in touch shortly.`,
                        from: fromNumber,
                        to: data.phone
                    });

                    await base44.asServiceRole.entities.Communication.create({
                        company_id: data.company_id,
                        contact_name: data.name,
                        contact_phone: data.phone,
                        communication_type: 'sms',
                        direction: 'outbound',
                        status: 'sent',
                        twilio_sid: msg.sid,
                        subject: 'Speed to Lead SMS',
                        message: msg.body,
                        cost: 0
                    });
                } catch (e) {
                    console.error("SMS failed:", e);
                }
            } else {
                console.error("Invalid Twilio Credentials:", { accountSid: accountSid ? "Set (starts with " + accountSid.substring(0,2) + ")" : "Not Set", fromNumber });
            }
        }

        // 4) After 30 seconds (20s more): Send Email
        await new Promise(resolve => setTimeout(resolve, 20000));

        if (data.email) {
            const resendApiKey = Deno.env.get("RESEND_API_KEY");
            const resendDomain = Deno.env.get("RESEND_DOMAIN");
            const fromEmail = resendDomain ? `noreply@${resendDomain}` : 'onboarding@resend.dev';
            
            if (resendApiKey) {
                try {
                    console.log(`Attempting to send email from ${fromEmail} to ${data.email}`);
                    const emailRes = await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${resendApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            from: fromEmail,
                            to: data.email,
                            subject: "We received your request!",
                            html: `<p>Hi ${data.name},</p><p>Thanks for reaching out. A member of our team will contact you shortly.</p><p>Best,<br>The Team</p>`
                        })
                    });

                    if (emailRes.ok) {
                        await base44.asServiceRole.entities.Communication.create({
                            company_id: data.company_id,
                            contact_name: data.name,
                            contact_email: data.email,
                            communication_type: 'email',
                            direction: 'outbound',
                            status: 'sent',
                            subject: 'Speed to Lead Email',
                            message: 'Welcome email sent'
                        });
                    } else {
                        console.error("Resend Email failed:", await emailRes.text());
                    }
                } catch (e) {
                    console.error("Email sending error:", e);
                }
            } else {
                console.error("RESEND_API_KEY not set in secrets, skipping email.");
            }
        }

        return Response.json({ success: true });

    } catch (error) {
        console.error("Error in Speed to Lead:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});