import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Email Webhook for Smart Glasses Photo Upload
 * 
 * Receives photos/videos from smart glasses via email and uploads them to CrewCam or Drone Inspections
 * 
 * Email Format: photos-{companyId}@mycrewcam.com
 * - Automatically identifies company from recipient email
 * - Identifies user from sender email
 * - Uploads attachments and creates JobMedia records
 * 
 * Webhook URL: Configure in Resend dashboard to point to this endpoint
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log('📧 Smart Glasses Email Webhook triggered');
        
        // Parse incoming email data from Resend
        const emailData = await req.json();
        
        console.log('📨 Email received:', {
            to: emailData.to,
            from: emailData.from,
            subject: emailData.subject,
            attachments: emailData.attachments?.length || 0
        });
        
        // Extract company ID from recipient email
        // Format: photos-abc123@mycrewcam.com -> abc123
        // Also supports: alias@mycrewcam.com -> alias
        let recipientEmail = emailData.to;
        
        // Handle array of recipients (Resend often sends an array)
        if (Array.isArray(recipientEmail)) {
            recipientEmail = recipientEmail[0];
        }

        // Match local part, optionally stripping 'photos-' prefix
        // Regex: optional 'photos-', capturing group for ID/Alias, then '@'
        const companyIdMatch = recipientEmail.match(/(?:photos-)?([a-zA-Z0-9-]+)@/i);
        
        if (!companyIdMatch) {
            console.error('❌ Invalid recipient email format:', recipientEmail);
            return Response.json({ 
                error: 'Invalid recipient email format.' 
            }, { status: 400 });
        }
        
        // Lowercase to ensure case-insensitive matching for alias
        const companyId = companyIdMatch[1].toLowerCase();
        const senderEmail = emailData.from;
        
        console.log('🏢 Company ID:', companyId);
        console.log('👤 Sender:', senderEmail);
        
        // Validate company exists
        let companies = [];

        // Only check ID if it looks like a valid ID (24 hex chars)
        if (/^[0-9a-fA-F]{24}$/.test(companyId)) {
            companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        }
        
        // If not found by ID (or invalid ID format), try looking up by smart_glasses_alias
        if (companies.length === 0) {
            console.log('🔍 Checking alias:', companyId);
            companies = await base44.asServiceRole.entities.Company.filter({ smart_glasses_alias: companyId });
        }

        if (companies.length === 0) {
            console.error('❌ Company not found by ID or alias:', companyId);
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }
        
        const company = companies[0];
        console.log('✅ Company found:', company.company_name);
        
        // Check if sender is authorized (staff member of this company)
        const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
            company_id: companyId,
            user_email: senderEmail
        });
        
        if (staffProfiles.length === 0) {
            console.warn('⚠️ Sender not found in company staff:', senderEmail);
            // Still allow upload but log warning
        }
        
        // Process attachments
        if (!emailData.attachments || emailData.attachments.length === 0) {
            console.log('⚠️ No attachments in email');

            // Create a log record so the user knows the email arrived
            await base44.asServiceRole.entities.JobMedia.create({
                company_id: company.id,
                file_url: 'https://placehold.co/600x400?text=No+Attachments',
                file_type: 'photo',
                uploaded_by_name: senderEmail,
                caption: `⚠️ Email received but NO attachments found. Subject: ${emailData.subject || 'No subject'}`,
                source: 'smart_glasses'
            });

            return Response.json({ 
                success: true, 
                message: 'Email received but no attachments found',
                company_id: companyId 
            });
        }
        
        const uploadedFiles = [];
        
        for (const attachment of emailData.attachments) {
            try {
                console.log('📎 Processing attachment:', attachment.filename);
                
                // Download attachment from Resend's content URL or base64
                let fileData;
                if (attachment.content) {
                    // Base64 encoded content
                    fileData = Uint8Array.from(atob(attachment.content), c => c.charCodeAt(0));
                } else if (attachment.contentUrl) {
                    // Fetch from URL
                    const response = await fetch(attachment.contentUrl);
                    fileData = await response.arrayBuffer();
                } else {
                    console.error('❌ No content or URL for attachment');
                    continue;
                }
                
                // Create a File object for upload
                const file = new File([fileData], attachment.filename, { 
                    type: attachment.contentType || 'image/jpeg' 
                });
                
                // Upload to Base44 storage
                const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
                
                console.log('✅ File uploaded:', file_url);
                
                // Determine if this is for CrewCam or Drone Inspection based on subject line
                const subject = emailData.subject?.toLowerCase() || '';
                let linkedToJob = false;
                
                // Try to match subject to existing inspection jobs
                if (subject.includes('inspection') || subject.includes('job') || subject.includes('crewcam')) {
                    // Extract job number or customer name from subject
                    const jobMatch = subject.match(/(?:job|inspection)\s*#?(\d+)/i);
                    const customerMatch = subject.match(/(?:customer|for)\s*:?\s*([a-z\s]+)/i);
                    
                    if (jobMatch || customerMatch) {
                        // Try to find matching inspection job
                        let inspectionJobs = await base44.asServiceRole.entities.InspectionJob.filter({
                            company_id: company.id
                        });
                        
                        if (jobMatch) {
                            const jobNumber = parseInt(jobMatch[1]);
                            inspectionJobs = inspectionJobs.filter(j => j.job_number === jobNumber);
                        } else if (customerMatch) {
                            const customerName = customerMatch[1].trim();
                            inspectionJobs = inspectionJobs.filter(j => 
                                j.customer_name?.toLowerCase().includes(customerName.toLowerCase())
                            );
                        }
                        
                        if (inspectionJobs.length > 0) {
                            // Link to first matching job
                            const job = inspectionJobs[0];
                            await base44.asServiceRole.entities.JobMedia.create({
                                company_id: company.id,
                                related_entity_id: job.id,
                                related_entity_type: 'InspectionJob',
                                file_url: file_url,
                                file_type: attachment.contentType?.startsWith('video/') ? 'video' : 'photo',
                                uploaded_by_name: senderEmail,
                                caption: `Uploaded via smart glasses from ${senderEmail}`,
                                source: 'smart_glasses'
                            });
                            
                            linkedToJob = true;
                            console.log('✅ Linked to InspectionJob:', job.job_number);
                        }
                    }
                }
                
                // If not linked to a specific job, create a generic JobMedia record
                if (!linkedToJob) {
                    await base44.asServiceRole.entities.JobMedia.create({
                        company_id: company.id,
                        file_url: file_url,
                        file_type: attachment.contentType?.startsWith('video/') ? 'video' : 'photo',
                        uploaded_by_name: senderEmail,
                        caption: `Uploaded via smart glasses from ${senderEmail}. Subject: ${emailData.subject || 'No subject'}`,
                        source: 'smart_glasses'
                    });
                    
                    console.log('✅ Created standalone JobMedia record');
                }
                
                uploadedFiles.push({
                    filename: attachment.filename,
                    url: file_url,
                    linked_to_job: linkedToJob
                });
                
            } catch (error) {
                console.error('❌ Error processing attachment:', attachment.filename, error);
            }
        }
        
        console.log('✅ Processing complete. Uploaded files:', uploadedFiles.length);
        
        // Send confirmation email back to user
        try {
            const Resend = (await import('npm:resend@4.0.0')).Resend;
            const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
            const domain = 'crewcam.com';
            
            await resend.emails.send({
                from: `${company.company_name || 'CrewCam'} <noreply@${domain}>`,
                to: senderEmail,
                subject: `✅ ${uploadedFiles.length} Photo(s) Uploaded Successfully`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">✅ Photos Uploaded</h1>
                        </div>
                        
                        <div style="background: white; padding: 30px; border: 2px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                            <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
                                Your smart glasses photos have been successfully uploaded to ${company.company_name}.
                            </p>
                            
                            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>Files Uploaded:</strong> ${uploadedFiles.length}</p>
                                <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 14px;"><strong>Subject:</strong> ${emailData.subject || 'No subject'}</p>
                            </div>
                            
                            ${uploadedFiles.map(f => `
                                <div style="padding: 12px; border-left: 3px solid #667eea; background: #f3f4f6; margin-bottom: 8px;">
                                    <p style="margin: 0; font-size: 14px; color: #111827;">📷 ${f.filename}</p>
                                    ${f.linked_to_job ? '<p style="margin: 4px 0 0 0; font-size: 12px; color: #059669;">✓ Linked to inspection job</p>' : ''}
                                </div>
                            `).join('')}
                            
                            <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                                View your photos in the CrewCam dashboard.
                            </p>
                        </div>
                    </div>
                `
            });
        } catch (emailError) {
            console.error('❌ Failed to send confirmation email:', emailError);
        }
        
        return Response.json({
            success: true,
            message: `Successfully processed ${uploadedFiles.length} file(s)`,
            company_id: companyId,
            uploaded_by: senderEmail,
            files: uploadedFiles
        });
        
    } catch (error) {
        console.error('❌ Smart Glasses Email Webhook Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});