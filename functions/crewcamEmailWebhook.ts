import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Parse incoming email (forwarded from Gmail or email service)
    const body = await req.json();
    
    console.log('📧 CrewCam email received:', body);
    
    // Extract email content
    const subject = body.subject || '';
    const fromEmail = body.from || '';
    const htmlContent = body.html || body.body_html || '';
    const textContent = body.text || body.body_text || '';
    
    // Determine email type
    const isInspectorAssignment = subject.includes('New Work Assignment');
    const isClientNotification = subject.includes('Property Inspection Scheduled');

    // Check if this might be a smart glasses upload (has attachments or sent to photos-*)
    // We forward these to the smartGlassesEmailWebhook
    const recipients = Array.isArray(body.to) ? body.to : [body.to];
    const isSmartGlasses = 
      (body.attachments && body.attachments.length > 0) || 
      recipients.some(email => email && email.includes('photos-')) ||
      (body.subject && body.subject.toLowerCase().includes('smart glasses'));
    
    if (isSmartGlasses && !isInspectorAssignment && !isClientNotification) {
      console.log('👓 Detected smart glasses email, forwarding to smartGlassesEmailWebhook');
      
      // Forward to the correct webhook function
      // We use the service role to invoke the function
      const response = await base44.asServiceRole.functions.invoke('smartGlassesEmailWebhook', body);
      
      return Response.json(response.data);
    }
    
    if (!isInspectorAssignment && !isClientNotification) {
      return Response.json({ 
        success: false, 
        message: 'Not a CrewCam inspection email' 
      });
    }
    
    // Use AI to extract structured data from email
    const extractedData = await base44.integrations.Core.InvokeLLM({
      prompt: `Extract inspection job details from this CrewCam email.

Email Subject: ${subject}
Email Content:
${textContent || htmlContent}

Extract ALL available fields and return them in the JSON schema.`,
      response_json_schema: {
        type: "object",
        properties: {
          property_address: { type: "string" },
          client_name: { type: "string" },
          client_phone: { type: "string" },
          client_email: { type: "string" },
          scheduled_date: { type: "string", format: "date" },
          inspection_time: { type: "string" },
          inspector_name: { type: "string" },
          inspector_phone: { type: "string" },
          inspector_email: { type: "string" },
          date_of_loss: { type: "string", format: "date" },
          claim_number: { type: "string" },
          property_type: { type: "string" },
          inspection_type: { type: "string" },
          priority: { type: "string" },
          damage_type: { type: "string" },
          access_instructions: { type: "string" }
        }
      }
    });
    
    console.log('✅ Extracted data:', extractedData);
    
    // Check if job already exists (by claim number or property address + date)
    const existingJobs = await base44.asServiceRole.entities.InspectionJob.filter({
      property_address: extractedData.property_address
    });
    
    const existingJob = existingJobs.find(job => 
      job.insurance_claim_number === extractedData.claim_number ||
      (job.scheduled_date === extractedData.scheduled_date && 
       job.property_address === extractedData.property_address)
    );
    
    if (existingJob) {
      return Response.json({
        success: true,
        message: 'Job already exists',
        job_id: existingJob.id,
        action: 'skipped_duplicate'
      });
    }
    
    // Find or create inspector profile
    let inspectorProfile = null;
    if (extractedData.inspector_email) {
      const profiles = await base44.asServiceRole.entities.InspectorProfile.filter({
        email: extractedData.inspector_email
      });
      
      if (profiles.length > 0) {
        inspectorProfile = profiles[0];
      } else if (extractedData.inspector_name) {
        // Create inspector profile
        inspectorProfile = await base44.asServiceRole.entities.InspectorProfile.create({
          full_name: extractedData.inspector_name,
          email: extractedData.inspector_email,
          phone: extractedData.inspector_phone,
          inspector_type: 'contractor',
          position: 'Certified Property Inspector'
        });
      }
    }
    
    // Create InspectionJob
    const newJob = await base44.asServiceRole.entities.InspectionJob.create({
      property_address: extractedData.property_address,
      client_name: extractedData.client_name,
      client_phone: extractedData.client_phone,
      client_email: extractedData.client_email,
      scheduled_date: extractedData.scheduled_date,
      inspection_time: extractedData.inspection_time || 'TBD',
      date_of_loss: extractedData.date_of_loss,
      insurance_claim_number: extractedData.claim_number,
      property_type: extractedData.property_type || 'Residential',
      inspection_type: extractedData.inspection_type || 'Property Damage Assessment',
      priority: extractedData.priority || 'Normal',
      damage_type: extractedData.damage_type,
      access_instructions: extractedData.access_instructions,
      status: 'assigned',
      crew_cam_id: extractedData.claim_number, // Use claim number as CrewCam ID
      assigned_to_email: inspectorProfile?.email || extractedData.inspector_email
    });
    
    console.log('✅ Created InspectionJob:', newJob.id);
    
    return Response.json({
      success: true,
      message: 'Inspection job created from CrewCam email',
      job_id: newJob.id,
      inspector_profile_id: inspectorProfile?.id
    });
    
  } catch (error) {
    console.error('❌ CrewCam email webhook error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});