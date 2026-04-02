import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Parse incoming email webhook (from email service like SendGrid, Mailgun, or Resend)
    const body = await req.json();
    
    console.log('📧 Smart Glasses email received:', {
      to: body.to,
      from: body.from,
      subject: body.subject,
      attachments: body.attachments?.length || 0
    });
    
    // Extract recipient email to get company ID
    // Format: photos-{companyId}@mycrewcam.com
    const recipientEmail = body.to || '';
    const companyIdMatch = recipientEmail.match(/photos-([a-zA-Z0-9_-]+)@/);
    
    if (!companyIdMatch) {
      console.error('❌ Invalid recipient email format:', recipientEmail);
      return Response.json({ 
        error: 'Invalid email format. Expected: photos-{companyId}@mycrewcam.com' 
      }, { status: 400 });
    }
    
    const companyId = companyIdMatch[1];
    console.log('🏢 Company ID:', companyId);
    
    // Verify company exists
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    if (companies.length === 0) {
      console.error('❌ Company not found:', companyId);
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    
    const company = companies[0];
    console.log('✅ Company found:', company.company_name);
    
    // Extract sender email
    const senderEmail = body.from || body.sender || '';
    console.log('👤 Sender email:', senderEmail);
    
    // Find user by email
    let userStaffProfile = null;
    if (senderEmail) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
        company_id: companyId,
        user_email: senderEmail
      });
      
      if (staffProfiles.length > 0) {
        userStaffProfile = staffProfiles[0];
        console.log('✅ User found:', userStaffProfile.full_name);
      } else {
        console.log('⚠️ User not found in company, will use sender email');
      }
    }
    
    // Extract attachments
    const attachments = body.attachments || [];
    if (attachments.length === 0) {
      console.log('⚠️ No attachments found in email');
      return Response.json({ 
        success: true,
        message: 'No photos to process',
        attachments: 0
      });
    }
    
    console.log(`📎 Processing ${attachments.length} attachments...`);
    
    // Process each attachment
    const uploadedPhotos = [];
    
    for (const attachment of attachments) {
      try {
        // Check if it's an image
        const contentType = attachment.contentType || attachment.content_type || '';
        if (!contentType.startsWith('image/')) {
          console.log(`⏭️ Skipping non-image: ${attachment.filename} (${contentType})`);
          continue;
        }
        
        console.log(`📷 Processing image: ${attachment.filename}`);
        
        // Attachment content is usually base64 encoded
        const base64Content = attachment.content || attachment.data || '';
        
        if (!base64Content) {
          console.error(`❌ No content for attachment: ${attachment.filename}`);
          continue;
        }
        
        // Convert base64 to blob
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: contentType });
        
        // Upload to storage
        const file = new File([blob], attachment.filename || 'photo.jpg', { type: contentType });
        const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
        
        console.log(`✅ Uploaded: ${file_url}`);
        
        uploadedPhotos.push({
          filename: attachment.filename,
          url: file_url,
          content_type: contentType,
          size: blob.size
        });
        
      } catch (uploadError) {
        console.error(`❌ Error uploading ${attachment.filename}:`, uploadError);
      }
    }
    
    console.log(`✅ Successfully uploaded ${uploadedPhotos.length} photos`);
    
    // Try to find an active inspection job for this user
    let linkedJob = null;
    
    if (userStaffProfile) {
      const activeJobs = await base44.asServiceRole.entities.InspectionJob.filter({
        company_id: companyId,
        assigned_to_email: userStaffProfile.user_email,
        status: { $in: ['assigned', 'in_progress', 'pending_review'] }
      }, '-created_date', 5);
      
      if (activeJobs.length > 0) {
        linkedJob = activeJobs[0]; // Use most recent active job
        console.log(`🔗 Linking photos to job: ${linkedJob.property_address}`);
      }
    }
    
    // Create JobMedia records for each photo
    const createdMediaRecords = [];
    
    for (const photo of uploadedPhotos) {
      try {
        const mediaRecord = await base44.asServiceRole.entities.JobMedia.create({
          company_id: companyId,
          inspection_job_id: linkedJob?.id || null,
          file_url: photo.url,
          file_name: photo.filename,
          file_type: 'photo',
          media_type: 'inspection_photo',
          uploaded_by: senderEmail,
          uploaded_from: 'smart_glasses',
          caption: `Uploaded via smart glasses from ${senderEmail}`,
          file_size: photo.size,
          content_type: photo.content_type
        });
        
        createdMediaRecords.push(mediaRecord);
        console.log(`✅ Created JobMedia record: ${mediaRecord.id}`);
        
      } catch (mediaError) {
        console.error('❌ Error creating JobMedia record:', mediaError);
      }
    }
    
    // Notify user
    if (userStaffProfile) {
      try {
        await base44.asServiceRole.entities.Notification.create({
          company_id: companyId,
          user_email: userStaffProfile.user_email,
          title: `📷 ${uploadedPhotos.length} Photo${uploadedPhotos.length > 1 ? 's' : ''} Uploaded`,
          message: linkedJob 
            ? `Photos uploaded and linked to job: ${linkedJob.property_address}` 
            : 'Photos uploaded successfully. View them in CrewCam Dashboard.',
          type: 'photo_uploaded',
          link_url: linkedJob ? `/inspection-capture?jobId=${linkedJob.id}` : '/inspections-dashboard',
          is_read: false
        });
        console.log('✅ Notification sent to user');
      } catch (notifError) {
        console.error('⚠️ Failed to send notification:', notifError);
      }
    }
    
    return Response.json({
      success: true,
      message: `Successfully processed ${uploadedPhotos.length} photo(s)`,
      company_id: companyId,
      company_name: company.company_name,
      sender: senderEmail,
      user_name: userStaffProfile?.full_name || 'Unknown',
      photos_uploaded: uploadedPhotos.length,
      linked_job: linkedJob ? {
        id: linkedJob.id,
        property_address: linkedJob.property_address
      } : null,
      media_records: createdMediaRecords.map(m => m.id)
    });
    
  } catch (error) {
    console.error('❌ Smart glasses webhook error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});