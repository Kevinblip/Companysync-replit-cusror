import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
    try {
        console.log("🚀 === INSPECTION ASSIGNMENT FUNCTION STARTED ===");

        const base44 = createClientFromRequest(req);
        const serviceClient = base44.asServiceRole;

        const loggedInUser = await base44.auth.me();
        if (!loggedInUser) {
            console.error("❌ Unauthorized: No user session found.");
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.log(`✅ User authenticated: ${loggedInUser.email}`);

        const { jobId, inspectorEmail } = await req.json();
        console.log(`📦 Payload: jobId=${jobId}, inspectorEmail=${inspectorEmail}`);

        if (!jobId || !inspectorEmail) {
            console.error("❌ Bad Request: Missing jobId or inspectorEmail.");
            return Response.json({ error: 'Missing jobId or inspectorEmail' }, { status: 400 });
        }

        // Fetch job, inspector, staff profile, and company in parallel
        console.log("🔍 Fetching job data...");
        const [job, inspectorUsers, staffProfiles] = await Promise.all([
            serviceClient.entities.InspectionJob.get(jobId),
            serviceClient.entities.User.filter({ email: inspectorEmail }),
            serviceClient.entities.StaffProfile.filter({ user_email: loggedInUser.email })
        ]);

        if (!job) {
            console.error(`❌ Job not found for ID: ${jobId}`);
            return Response.json({ error: 'Inspection job not found' }, { status: 404 });
        }
        console.log(`✅ Job found: ${job.property_address}`);

        const inspector = inspectorUsers[0];
        if (!inspector) {
            console.error(`❌ Inspector not found for email: ${inspectorEmail}`);
            return Response.json({ error: 'Inspector user not found' }, { status: 404 });
        }
        console.log(`✅ Inspector found: ${inspector.full_name} (${inspector.email})`);

        // Get inspector's staff profile for phone number AND PHOTO
        const inspectorStaffProfiles = await serviceClient.entities.StaffProfile.filter({ user_email: inspectorEmail });
        const inspectorInspectorProfiles = await serviceClient.entities.InspectorProfile.filter({ email: inspectorEmail });
        
        const inspectorProfile = inspectorStaffProfiles[0] || inspectorInspectorProfiles[0];
        const inspectorPhone = inspectorProfile?.phone || inspectorProfile?.twilio_number || 'Contact via email';
        const inspectorPhoto = inspectorProfile?.avatar_url || `https://avatar.vercel.sh/${inspectorEmail}.png`;
        console.log(`📞 Inspector phone: ${inspectorPhone}`);
        console.log(`📸 Inspector photo: ${inspectorPhoto}`);

        // Get company
        let company = null;
        const companyId = staffProfiles[0]?.company_id;
        if (companyId) {
            company = await serviceClient.entities.Company.get(companyId);
            console.log(`✅ Company from staff profile: ${company?.company_name} (ID: ${companyId})`);
        } else {
            const companies = await serviceClient.entities.Company.filter({ created_by: loggedInUser.email });
            company = companies[0];
            if(company) console.log(`✅ Company from created_by: ${company?.company_name} (ID: ${company.id})`);
        }

        if (!company) {
            console.warn("⚠️ No company profile found. Using default branding.");
        }
        const companyName = company?.company_name || 'AI CRM Pro';
        const companyEmail = company?.email || 'support@aicrmpro.com';
        const companyPhone = company?.phone || '';
        const actualCompanyId = company?.id;

        // Initialize Resend with company-branded FROM
        const resendApiKey = Deno.env.get('RESEND_API_KEY');
        const resend = resendApiKey ? new Resend(resendApiKey) : null;
        const fromEmail = `${companyName} <noreply@mycrewcam.com>`;

        console.log(`🏢 Company: ${companyName}, Email: ${companyEmail}, Phone: ${companyPhone}, ID: ${actualCompanyId}`);

        // Fetch templates
        console.log("📧 Fetching email/SMS templates...");
        const [emailTemplates, smsTemplates] = await Promise.all([
            serviceClient.entities.EmailTemplate.filter({ category: 'general', is_active: true }),
            serviceClient.entities.SMSTemplate.filter({ is_active: true })
        ]);
        
        const inspectorEmailTemplate = emailTemplates.find(t => 
            t.template_name?.includes('Inspector Assignment')
        );
        const clientEmailTemplate = emailTemplates.find(t => 
            t.template_name?.includes('Client - Inspection Confirmation')
        );
        const inspectorSMSTemplate = smsTemplates.find(t => 
            t.template_name?.includes('Inspector Assignment')
        );
        const clientSMSTemplate = smsTemplates.find(t => 
            t.template_name?.includes('Client - Inspection Confirmation')
        );

        console.log(`📋 Templates found: Inspector Email=${!!inspectorEmailTemplate}, Client Email=${!!clientEmailTemplate}, Inspector SMS=${!!inspectorSMSTemplate}, Client SMS=${!!clientSMSTemplate}`);

        // Helper to replace merge fields
        const replaceMergeFields = (text, data) => {
            if (!text) return text;
            let result = text;
            Object.entries(data).forEach(([key, value]) => {
                const regex = new RegExp(`\\{${key}\\}`, 'g');
                result = result.replace(regex, value || 'Not provided');
            });
            return result;
        };

        // Prepare merge data
        const mergeData = {
            company_name: companyName,
            company_email: companyEmail,
            company_phone: companyPhone,
            inspector_name: inspector.full_name,
            inspector_email: inspectorEmail,
            inspector_phone: inspectorPhone,
            inspector_photo: inspectorPhoto,
            property_address: job.property_address,
            client_name: job.client_name || 'Contact client directly',
            client_phone: job.client_phone || 'Not provided',
            client_email: job.client_email || 'Not provided',
            scheduled_date: job.scheduled_date || 'To be confirmed',
            scheduled_time: job.inspection_time || 'To be confirmed',
            damage_type: job.damage_type || 'Not specified',
            date_of_loss: job.date_of_loss || 'Not provided',
            claim_number: job.insurance_claim_number || 'Not provided',
            property_type: job.property_type || 'Residential',
            inspection_type: job.inspection_type || 'Property Damage Assessment',
            priority: job.priority || 'Normal',
            access_instructions: job.access_instructions || 'None provided'
        };

        console.log("📝 Merge data prepared");

        // 1. Send Email to Inspector
        console.log("📧 Sending email to inspector...");
        const inspectorSubject = replaceMergeFields(
            inspectorEmailTemplate?.subject || '🔧 New Work Assignment: {property_address}',
            mergeData
        );
        const inspectorBody = replaceMergeFields(
            inspectorEmailTemplate?.body || `
                <h2>New Inspection Assignment</h2>
                <p><strong>Property:</strong> ${job.property_address}</p>
                <p><strong>Client:</strong> ${job.client_name}</p>
                <p><strong>Phone:</strong> ${job.client_phone || 'Not provided'}</p>
                <p><strong>Date:</strong> ${job.scheduled_date || 'TBD'}</p>
                <p><strong>Time:</strong> ${job.inspection_time || 'TBD'}</p>
                <p><strong>Priority:</strong> ${job.priority || 'Normal'}</p>
                <p><strong>Access Instructions:</strong> ${job.access_instructions || 'None provided'}</p>
            `,
            mergeData
        );
        
        try {
            if (resend) {
                await resend.emails.send({
                    from: fromEmail,
                    to: inspectorEmail,
                    subject: inspectorSubject,
                    html: inspectorBody,
                });
            } else {
                await base44.asServiceRole.integrations.Core.SendEmail({
                    to: inspectorEmail,
                    subject: inspectorSubject,
                    body: inspectorBody,
                    from_name: companyName
                });
            }
            console.log(`✅ Inspector email SENT to ${inspectorEmail}`);
        } catch (emailError) {
            console.error(`❌ FAILED to send inspector email:`, emailError.message, emailError);
            throw new Error(`Failed to send inspector email: ${emailError.message}`);
        }

        // 2. Send SMS to Inspector (if they have a phone)
        if (inspectorPhone && inspectorPhone !== 'Contact via email' && actualCompanyId) {
            console.log(`📱 Sending SMS to inspector at ${inspectorPhone}...`);
            const inspectorSMSMessage = replaceMergeFields(
                inspectorSMSTemplate?.message || '🔧 New Inspection Assigned!\n\n📍 {property_address}\n👤 Client: {client_name}\n📞 {client_phone}\n📅 {scheduled_date}\n\nCheck your email for full details. - {company_name}',
                mergeData
            );
            
            try {
                const smsResult = await base44.functions.invoke('sendSMS', {
                    to: inspectorPhone,
                    message: inspectorSMSMessage,
                    contactName: inspector.full_name,
                    companyId: actualCompanyId
                });
                console.log(`✅ Inspector SMS SENT to ${inspectorPhone}`, smsResult);
            } catch (smsError) {
                console.error(`⚠️ Failed to send SMS to inspector (non-critical):`, smsError.message, smsError);
            }
        } else {
            console.log(`⚠️ Inspector has no phone number or no company ID, skipping SMS`);
        }

        // 3. Send Email to Client (with inspector profile!)
        let clientMessage = "Inspector notified via email.";
        if (job.client_email && job.client_email !== 'Not provided') {
            console.log(`📧 Sending confirmation email to client at ${job.client_email}...`);
            const clientSubject = replaceMergeFields(
                clientEmailTemplate?.subject || '🏠 Property Inspection Scheduled - {property_address}',
                mergeData
            );
            const clientBody = replaceMergeFields(
                clientEmailTemplate?.body || `
                    <h2>Inspection Confirmation</h2>
                    <p>Your property inspection has been scheduled!</p>
                    <p><strong>Property:</strong> ${job.property_address}</p>
                    <p><strong>Date:</strong> ${job.scheduled_date || 'To be confirmed'}</p>
                    <p><strong>Time:</strong> ${job.inspection_time || 'To be confirmed'}</p>
                    <hr>
                    <h3>Your Inspector</h3>
                    <p><strong>Name:</strong> ${inspector.full_name}</p>
                    <p><strong>Phone:</strong> ${inspectorPhone}</p>
                    <p><strong>Email:</strong> ${inspectorEmail}</p>
                    <p>Your inspector will contact you before the visit.</p>
                `,
                mergeData
            );
            
            try {
                if (resend) {
                    await resend.emails.send({
                        from: fromEmail,
                        to: job.client_email,
                        subject: clientSubject,
                        html: clientBody,
                    });
                } else {
                    await base44.asServiceRole.integrations.Core.SendEmail({
                        to: job.client_email,
                        subject: clientSubject,
                        body: clientBody,
                        from_name: companyName
                    });
                }
                console.log(`✅ Client confirmation email SENT to ${job.client_email}`);
                clientMessage = "Inspector and client notified via email.";
            } catch (emailError) {
                console.error(`❌ FAILED to send client email:`, emailError.message, emailError);
            }
        } else {
            console.log(`⚠️ Client email not provided, skipping client email`);
        }

        // 4. Send SMS to Client (if they have a phone)
        if (job.client_phone && job.client_phone !== 'Not provided' && actualCompanyId) {
            console.log(`📱 Sending SMS to client at ${job.client_phone}...`);
            const clientSMSMessage = replaceMergeFields(
                clientSMSTemplate?.message || '✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}',
                mergeData
            );
            
            try {
                const clientSMSResult = await base44.functions.invoke('sendSMS', {
                    to: job.client_phone,
                    message: clientSMSMessage,
                    contactName: job.client_name,
                    companyId: actualCompanyId
                });
                console.log(`✅ Client SMS SENT to ${job.client_phone}`, clientSMSResult);
                clientMessage += " SMS sent to both inspector and client.";
            } catch (smsError) {
                console.error(`⚠️ Failed to send SMS to client (non-critical):`, smsError.message, smsError);
            }
        } else {
            console.log(`⚠️ Client phone not provided or no company ID, skipping client SMS`);
        }

        console.log("✅ === ASSIGNMENT COMPLETE ===");
        return Response.json({ 
            success: true, 
            message: clientMessage,
            details: {
                inspector_email_sent: true,
                client_email_sent: !!job.client_email,
                inspector_sms_sent: inspectorPhone !== 'Contact via email',
                client_sms_sent: !!job.client_phone
            }
        });

    } catch (error) {
        console.error('❌ === CRITICAL ERROR IN ASSIGNMENT ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('=========================================');
        return Response.json({ 
            error: 'An internal server error occurred while sending the assignment.',
            details: error.message 
        }, { status: 500 });
    }
});