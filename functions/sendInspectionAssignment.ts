import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { sendEmail } from './_sendEmail.ts';

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

        const { jobId, inspectorEmail, appUrl, isResend } = await req.json();
        console.log(`📦 Payload: jobId=${jobId}, inspectorEmail=${inspectorEmail}, isResend=${!!isResend}`);

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
        const fromEmail = `${companyName} <noreply@companysync.io>`;

        console.log(`🏢 Company: ${companyName}, Email: ${companyEmail}, Phone: ${companyPhone}, ID: ${actualCompanyId}`);

        // Fetch templates — prefer company-specific templates when a company ID is known
        console.log("📧 Fetching email/SMS templates...");
        const emailFilterParams = actualCompanyId
            ? { category: 'general', is_active: true, company_id: actualCompanyId }
            : { category: 'general', is_active: true };
        const smsFilterParams = actualCompanyId
            ? { is_active: true, company_id: actualCompanyId }
            : { is_active: true };
        const [emailTemplates, smsTemplates] = await Promise.all([
            serviceClient.entities.EmailTemplate.filter(emailFilterParams),
            serviceClient.entities.SMSTemplate.filter(smsFilterParams)
        ]);
        
        const assignmentEmailTemplate = emailTemplates.find(t =>
            t.template_name?.includes('Inspector Assignment')
        );
        const reminderEmailTemplate = emailTemplates.find(t =>
            t.template_name?.includes('Inspector Resend Reminder')
        );
        const clientEmailTemplate = emailTemplates.find(t =>
            t.template_name?.includes('Client - Inspection Confirmation')
        );
        const assignmentSMSTemplate = smsTemplates.find(t =>
            t.template_name?.includes('Inspector Assignment')
        );
        const reminderSMSTemplate = smsTemplates.find(t =>
            t.template_name?.includes('Inspector Resend Reminder')
        );
        const clientSMSTemplate = smsTemplates.find(t =>
            t.template_name?.includes('Client - Inspection Confirmation')
        );

        // For a resend, prefer reminder fields when populated, then assignment fields, then hardcoded defaults.
        // Field-level (not record-level) fallback so a reminder template with blank fields still falls back
        // to the assignment template — matching the helper text in Company Setup.
        const inspectorEmailTemplate = isResend
            ? {
                subject: reminderEmailTemplate?.subject || assignmentEmailTemplate?.subject,
                body: reminderEmailTemplate?.body || assignmentEmailTemplate?.body,
            }
            : assignmentEmailTemplate;
        const inspectorSMSTemplate = isResend
            ? {
                message: reminderSMSTemplate?.message || assignmentSMSTemplate?.message,
            }
            : assignmentSMSTemplate;
        const usingReminderEmail = isResend && !!(reminderEmailTemplate?.subject || reminderEmailTemplate?.body);
        const usingReminderSMS = isResend && !!reminderSMSTemplate?.message;

        console.log(`📋 Templates found: Inspector Email=${!!inspectorEmailTemplate} (reminder=${usingReminderEmail}), Client Email=${!!clientEmailTemplate}, Inspector SMS=${!!inspectorSMSTemplate} (reminder=${usingReminderSMS}), Client SMS=${!!clientSMSTemplate}`);

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

        // Build the direct CrewCam link for this specific job
        const baseUrl = appUrl || 'https://app.mycrewcam.com';
        const crewcamLink = `${baseUrl}/InspectionCapture?jobId=${jobId}`;

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
            access_instructions: job.access_instructions || 'None provided',
            crewcam_link: crewcamLink,
        };

        console.log("📝 Merge data prepared");

        // 1. Send Email to Inspector
        console.log("📧 Sending email to inspector...");
        const defaultInspectorSubject = isResend
            ? '🔁 Reminder: Your PhotoSync link for {property_address}'
            : '🔧 New Work Assignment: {property_address}';
        const inspectorSubject = replaceMergeFields(
            inspectorEmailTemplate?.subject || defaultInspectorSubject,
            mergeData
        );
        // NOTE: The default HTML below is the canonical branded template for inspector assignment emails.
        // The frontend preview in src/utils/defaultEmailTemplates.js (DEFAULT_ASSIGNMENT_EMAIL_HTML)
        // mirrors this template and must be kept in sync if either is updated.
        const inspectorBody = replaceMergeFields(
            inspectorEmailTemplate?.body || `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden">
  <div style="background:#1e40af;padding:28px 32px;color:white">
    <h1 style="margin:0;font-size:22px">📸 You've Been Assigned to PhotoSync</h1>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px">{company_name}</p>
  </div>
  <div style="padding:28px 32px;background:white">
    <p style="font-size:16px;color:#1f2937">Hi {inspector_name},</p>
    <p style="color:#374151;margin-bottom:24px">You have a new inspection assignment. Here's everything you need to know before you head out.</p>

    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0 0 12px;font-weight:700;color:#1e40af;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">📋 Job Details</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px;vertical-align:top">Address</td><td style="padding:6px 0;font-weight:600;color:#111827">📍 {property_address}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Scheduled</td><td style="padding:6px 0;font-weight:600;color:#059669">📅 {scheduled_date}{scheduled_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Type</td><td style="padding:6px 0;color:#111827">{inspection_type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Damage</td><td style="padding:6px 0;color:#111827">{damage_type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Priority</td><td style="padding:6px 0;font-weight:600;color:#dc2626">{priority}</td></tr>
        {claim_number_row}
      </table>
    </div>

    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0 0 12px;font-weight:700;color:#166534;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">👤 Contact Info</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px">Client</td><td style="padding:6px 0;font-weight:600;color:#111827">{client_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:6px 0;font-weight:600;color:#111827"><a href="tel:{client_phone}" style="color:#1d4ed8;text-decoration:none">📞 {client_phone}</a></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:6px 0;color:#111827">{client_email}</td></tr>
      </table>
    </div>

    {access_block}
    {special_block}

    <div style="text-align:center;margin:28px 0 8px">
      <a href="{crewcam_link}" style="display:inline-block;background:#1e40af;color:white;font-size:17px;font-weight:700;padding:16px 40px;border-radius:10px;text-decoration:none;letter-spacing:0.3px">📸 Start Taking Photos</a>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:8px">Tap the button above to open PhotoSync directly for this job</p>
  </div>
  <div style="padding:16px 32px;background:#f1f5f9;text-align:center">
    <img src="https://getcompanysync.com/brand/companysync-roofing-crm-logo-horizontal.png" alt="CompanySync roofing CRM logo" width="140" height="35" style="display:block;margin:0 auto 8px;width:140px;height:auto;border:0;" />
    <p style="margin:0;color:#94a3b8;font-size:12px">{company_name} • Powered by CompanySync</p>
  </div>
</div>`,
            {
                ...mergeData,
                'scheduled_time': job.inspection_time ? ` at ${job.inspection_time}` : '',
                'claim_number_row': job.insurance_claim_number ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Claim #</td><td style="padding:6px 0;color:#111827">${job.insurance_claim_number}</td></tr>` : '',
                'access_block': job.access_instructions ? `<div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:16px;margin:0 0 20px"><p style="margin:0 0 4px;font-weight:600;color:#854d0e;font-size:13px">🔑 Access Instructions</p><p style="margin:0;color:#713f12;font-size:14px">${job.access_instructions}</p></div>` : '',
                'special_block': job.special_instructions ? `<div style="background:#fdf4ff;border:1px solid #d8b4fe;border-radius:8px;padding:16px;margin:0 0 20px"><p style="margin:0 0 4px;font-weight:600;color:#6b21a8;font-size:13px">📝 Special Instructions</p><p style="margin:0;color:#581c87;font-size:14px">${job.special_instructions}</p></div>` : '',
            }
        );
        
        // Track what was actually sent for the response
        const results = {
            inspector_email: false,
            inspector_sms: false,
            client_email: false,
            client_sms: false,
            inspector_email_error: '',
            inspector_sms_skip_reason: '',
            client_email_skip_reason: '',
            client_sms_skip_reason: '',
        };

        // 1b. Send Email to Inspector (result tracked; no re-throw so later steps still run)
        console.log("📧 Sending email to inspector...");
        try {
            try {
                await sendEmail({ from: fromEmail, to: inspectorEmail, subject: inspectorSubject, html: inspectorBody });
            } catch (_emailErr) {
                await base44.asServiceRole.integrations.Core.SendEmail({
                    to: inspectorEmail, subject: inspectorSubject, body: inspectorBody, from_name: companyName
                });
            }
            console.log(`✅ Inspector email SENT to ${inspectorEmail}`);
            results.inspector_email = true;
        } catch (emailError) {
            console.error(`❌ FAILED to send inspector email:`, emailError.message, emailError);
            results.inspector_email_error = emailError.message;
            // Do NOT re-throw — allow SMS and client notifications to still go out
        }

        // 2. Send SMS to Inspector (if they have a phone)
        // NOTE: calledFromService:true bypasses the per-user auth check in sendSMS
        //       because this call is initiated server-side, not directly by the user.
        if (inspectorPhone && inspectorPhone !== 'Contact via email' && actualCompanyId) {
            console.log(`📱 Sending SMS to inspector at ${inspectorPhone}...`);
            const defaultInspectorSMS = isResend
                ? '🔁 Reminder from {company_name}: here\'s your PhotoSync link again for {property_address} on {scheduled_date}.\n\n{crewcam_link}'
                : '📸 New PhotoSync Assignment — {company_name}\n\n👤 {client_name}\n📍 {property_address}\n📞 {client_phone}\n📅 {scheduled_date}\n\nTap to start taking photos:\n{crewcam_link}';
            const inspectorSMSMessage = replaceMergeFields(
                inspectorSMSTemplate?.message || defaultInspectorSMS,
                mergeData
            );
            
            try {
                const smsResult = await base44.functions.invoke('sendSMS', {
                    to: inspectorPhone,
                    message: inspectorSMSMessage,
                    contactName: inspector.full_name,
                    companyId: actualCompanyId,
                    calledFromService: true,
                });
                console.log(`✅ Inspector SMS SENT to ${inspectorPhone}`, smsResult);
                results.inspector_sms = true;
            } catch (smsError) {
                console.error(`⚠️ Inspector SMS failed:`, smsError.message, smsError);
                results.inspector_sms_skip_reason = smsError.message;
            }
        } else {
            const skipReason = !actualCompanyId ? 'no company ID' : 'no phone number on inspector profile';
            console.log(`⚠️ Skipping inspector SMS: ${skipReason}`);
            results.inspector_sms_skip_reason = skipReason;
        }

        // 3. Send Email to Client (homeowner confirmation with inspector details)
        const clientEmail = job.client_email?.trim();
        if (clientEmail && clientEmail !== 'Not provided' && clientEmail !== 'Not Provided') {
            console.log(`📧 Sending confirmation email to client at ${clientEmail}...`);
            const clientSubject = replaceMergeFields(
                clientEmailTemplate?.subject || '🏠 Your Property Inspection is Confirmed — {property_address}',
                mergeData
            );
            // NOTE: The default HTML below is the canonical branded template for client confirmation emails.
            // The frontend preview in src/utils/defaultEmailTemplates.js (DEFAULT_CLIENT_EMAIL_HTML)
            // mirrors this template and must be kept in sync if either is updated.
            const defaultClientBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden">
  <div style="background:#059669;padding:28px 32px;color:white">
    <h1 style="margin:0;font-size:22px">✅ Inspection Confirmed</h1>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px">{company_name}</p>
  </div>
  <div style="padding:28px 32px;background:white">
    <p style="font-size:16px;color:#1f2937">Hi {client_name},</p>
    <p style="color:#374151;margin-bottom:24px">Your property inspection has been scheduled. Here are the details:</p>

    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0 0 12px;font-weight:700;color:#166534;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">📋 Inspection Details</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px">Property</td><td style="padding:6px 0;font-weight:600;color:#111827">📍 {property_address}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Date</td><td style="padding:6px 0;font-weight:600;color:#059669">📅 {scheduled_date}{scheduled_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Type</td><td style="padding:6px 0;color:#111827">{inspection_type}</td></tr>
      </table>
    </div>

    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 12px;font-weight:700;color:#1e40af;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">👷 Your Inspector</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px">Name</td><td style="padding:6px 0;font-weight:600;color:#111827">{inspector_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:6px 0;font-weight:600"><a href="tel:{inspector_phone}" style="color:#1d4ed8;text-decoration:none">📞 {inspector_phone}</a></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:6px 0;color:#111827">{inspector_email}</td></tr>
      </table>
    </div>

    <p style="color:#6b7280;font-size:14px;margin:0">Your inspector will reach out to confirm the appointment. If you have any questions, contact us at <a href="mailto:{company_email}" style="color:#1d4ed8">{company_email}</a>.</p>
  </div>
  <div style="padding:16px 32px;background:#f1f5f9;text-align:center">
    <img src="https://getcompanysync.com/brand/companysync-roofing-crm-logo-horizontal.png" alt="CompanySync roofing CRM logo" width="140" height="35" style="display:block;margin:0 auto 8px;width:140px;height:auto;border:0;" />
    <p style="margin:0;color:#94a3b8;font-size:12px">{company_name} • Powered by CompanySync</p>
  </div>
</div>`;
            const clientBody = replaceMergeFields(
                clientEmailTemplate?.body || defaultClientBody,
                {
                    ...mergeData,
                    'scheduled_time': job.inspection_time ? ` at ${job.inspection_time}` : '',
                }
            );
            
            try {
                try {
                    await sendEmail({ from: fromEmail, to: clientEmail, subject: clientSubject, html: clientBody });
                } catch (_emailErr) {
                    await base44.asServiceRole.integrations.Core.SendEmail({
                        to: clientEmail,
                        subject: clientSubject,
                        body: clientBody,
                        from_name: companyName
                    });
                }
                console.log(`✅ Client confirmation email SENT to ${clientEmail}`);
                results.client_email = true;
            } catch (emailError) {
                console.error(`❌ FAILED to send client email:`, emailError.message, emailError);
                results.client_email_skip_reason = emailError.message;
            }
        } else {
            const skipReason = clientEmail ? 'placeholder value' : 'no email address on job';
            console.log(`⚠️ Skipping client email: ${skipReason}`);
            results.client_email_skip_reason = skipReason;
        }

        // 4. Send SMS to Client (if they have a phone)
        const clientPhone = job.client_phone?.trim();
        if (clientPhone && clientPhone !== 'Not provided' && clientPhone !== 'Not Provided' && actualCompanyId) {
            console.log(`📱 Sending SMS to client at ${clientPhone}...`);
            const clientSMSMessage = replaceMergeFields(
                clientSMSTemplate?.message || '✅ {company_name}: Your inspection at {property_address} is confirmed for {scheduled_date}. Your inspector is {inspector_name} — {inspector_phone}.',
                mergeData
            );
            
            try {
                const clientSMSResult = await base44.functions.invoke('sendSMS', {
                    to: clientPhone,
                    message: clientSMSMessage,
                    contactName: job.client_name,
                    companyId: actualCompanyId,
                    calledFromService: true,
                });
                console.log(`✅ Client SMS SENT to ${clientPhone}`, clientSMSResult);
                results.client_sms = true;
            } catch (smsError) {
                console.error(`⚠️ Client SMS failed:`, smsError.message, smsError);
                results.client_sms_skip_reason = smsError.message;
            }
        } else {
            const skipReason = !actualCompanyId ? 'no company ID' : !clientPhone ? 'no phone number on job' : 'placeholder value';
            console.log(`⚠️ Skipping client SMS: ${skipReason}`);
            results.client_sms_skip_reason = skipReason;
        }

        // Record the notification timestamp and increment the counter on the job
        const lastNotifiedAt = new Date().toISOString();
        try {
            // Note: this read-modify-write is not atomic. Concurrent resends
            // on the same job are uncommon in practice (human-triggered), so
            // the race window is acceptable until a DB-side atomic API is available.
            const HISTORY_CAP = 50;
            const currentCount = typeof job.notification_count === 'number' ? job.notification_count : 0;
            const currentHistory = Array.isArray(job.notification_history) ? job.notification_history : [];
            const newHistoryEntry = {
                sent_at: lastNotifiedAt,
                sent_by_email: loggedInUser.email,
                type: isResend ? 'resend' : 'assignment',
            };
            const updatedHistory = [...currentHistory, newHistoryEntry].slice(-HISTORY_CAP);
            const updatePayload: Record<string, unknown> = {
                last_notified_at: lastNotifiedAt,
                notification_count: currentCount + 1,
                notification_history: updatedHistory,
            };
            if (isResend) {
                updatePayload.last_resend_at = lastNotifiedAt;
            } else {
                // Only set first_notified_at on the very first assignment send
                if (!job.first_notified_at) {
                    updatePayload.first_notified_at = lastNotifiedAt;
                }
            }
            await serviceClient.entities.InspectionJob.update(jobId, updatePayload);
            console.log(`🕒 last_notified_at updated to ${lastNotifiedAt}${isResend ? `, last_resend_at updated` : `, first_notified_at=${updatePayload.first_notified_at ? 'set' : 'already exists'}`}, notification_count=${currentCount + 1}`);
        } catch (updateError) {
            console.error(`⚠️ Failed to update last_notified_at (non-critical):`, updateError.message);
        }

        const sentCount = [results.inspector_email, results.inspector_sms, results.client_email, results.client_sms].filter(Boolean).length;
        const summaryParts = [];
        if (results.inspector_email) summaryParts.push('inspector email');
        if (results.inspector_sms) summaryParts.push('inspector SMS');
        if (results.client_email) summaryParts.push('homeowner email');
        if (results.client_sms) summaryParts.push('homeowner SMS');
        const summaryMessage = sentCount > 0
            ? `Sent: ${summaryParts.join(', ')}.`
            : 'No notifications were delivered — check email/SMS configuration.';

        console.log(`✅ === ASSIGNMENT COMPLETE — ${sentCount} notifications sent ===`);
        if (results.inspector_email_error) console.warn(`⚠️ Inspector email error: ${results.inspector_email_error}`);
        return Response.json({ 
            success: true, 
            message: summaryMessage,
            last_notified_at: lastNotifiedAt,
            details: results,
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