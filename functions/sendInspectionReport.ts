import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('🚀 === STARTING SEND INSPECTION REPORT ===');
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('❌ No user authenticated');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ User authenticated:', user.email);

    const body = await req.json();
    console.log('📥 Request body keys:', Object.keys(body));
    
    const { inspectionJobId, sendToClient, sendToAdjuster, adjusterEmail, sendToProductionManager, sendToSalesRep, sendToCustomEmails, customEmails, pdfBase64 } = body;
    console.log(`📄 Received pre-generated PDF: ${pdfBase64 ? 'YES' : 'NO'}`);

    console.log('🚀 Sending report for job:', inspectionJobId);

    // Fetch inspection job
    const job = await base44.entities.InspectionJob.get(inspectionJobId);
    if (!job) {
      console.error('❌ Job not found');
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }
    console.log('✅ Job found:', job.property_address);

    // Fetch company info for email
    let company = null;
    try {
      if (job.company_id) {
        const companies = await base44.asServiceRole.entities.Company.filter({ id: job.company_id });
        company = companies[0];
      }
      if (!company) {
        const userCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        company = userCompanies[0];
      }
      console.log('✅ Using company:', company?.company_name || 'None');
    } catch (e) {
      console.error('⚠️ Error fetching company:', e.message);
    }

    // Use pre-generated PDF from frontend
    if (!pdfBase64) {
      return Response.json({ error: 'No PDF provided' }, { status: 400 });
    }
    
    console.log(`✅ Received pre-generated PDF (${pdfBase64.length} chars)`);

    // Initialize Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }
    
    const resend = new Resend(resendApiKey);
    console.log('📧 Resend initialized with pre-generated PDF');

    let clientSent = false;
    let adjusterSent = false;
    let productionManagerSent = false;
    let salesRepSent = false;
    let customSent = false;
    let customCount = 0;
    let clientError = null;
    let adjusterError = null;

    // Send to client
    if (sendToClient && job.client_email) {
      try {
        console.log('📧 Preparing to send email to client:', job.client_email);
        
        const emailPayload = {
          from: `${company?.company_name || 'Inspection Team'} <reports@mycrewcam.com>`,
          to: [job.client_email],
          subject: `Inspection Report - ${job.property_address}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e40af;">Your Inspection Report is Ready</h2>
              <p>Dear ${job.client_name || 'Valued Client'},</p>
              <p>Please find attached your complete inspection report for <strong>${job.property_address}</strong>.</p>
              <p style="color: #666; font-size: 12px; margin-top: 30px;">Best regards,<br>${company?.company_name || 'Your Inspection Team'}</p>
            </div>
          `,
          attachments: [{
            filename: `Inspection_Report_${job.property_address?.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
            content: pdfBase64
          }]
        };
        
        console.log('📤 Sending email via Resend...');
        const result = await resend.emails.send(emailPayload);
        console.log('📬 Resend response:', JSON.stringify(result, null, 2));
        
        clientSent = true;
        console.log('✅ Email sent to client successfully. Resend ID:', result.data?.id);

        await base44.asServiceRole.entities.EmailTracking.create({
          tracking_id: result.data?.id || `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email_type: 'inspection_report',
          related_entity_id: inspectionJobId,
          related_entity_type: 'InspectionJob',
          recipient_email: job.client_email,
          recipient_name: job.client_name,
          subject: `Inspection Report - ${job.property_address}`,
          status: 'sent',
          resend_email_id: result.data?.id,
          sent_at: new Date().toISOString()
        });
      } catch (e) {
        clientError = e.message;
        console.error('❌ FAILED TO SEND EMAIL TO CLIENT:', e.message);
        console.error('Email error details:', e);
      }
    }

    // Send to adjuster
    if (sendToAdjuster && adjusterEmail) {
      try {
        console.log('📧 Sending email to adjuster:', adjusterEmail);
        
        const result = await resend.emails.send({
          from: `${company?.company_name || 'Inspection Team'} <reports@mycrewcam.com>`,
          to: [adjusterEmail],
          subject: `Insurance Claim Report - ${job.insurance_claim_number || job.property_address}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e40af;">Insurance Claim Documentation</h2>
              <p><strong>Claim #:</strong> ${job.insurance_claim_number || 'N/A'}</p>
              <p><strong>Property:</strong> ${job.property_address}</p>
              <p><strong>Insured:</strong> ${job.client_name}</p>
              <p>Please find attached the complete inspection report with estimate.</p>
              <p style="color: #666; font-size: 12px; margin-top: 30px;">Best regards,<br>${company?.company_name || 'Inspection Team'}</p>
            </div>
          `,
          attachments: [{
            filename: `Claim_${job.insurance_claim_number || 'Report'}.pdf`,
            content: pdfBase64
          }]
        });
        
        adjusterSent = true;
        console.log('✅ Email sent to adjuster successfully. Resend ID:', result.data?.id);

        await base44.asServiceRole.entities.EmailTracking.create({
          tracking_id: result.data?.id || `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email_type: 'inspection_report',
          related_entity_id: inspectionJobId,
          related_entity_type: 'InspectionJob',
          recipient_email: adjusterEmail,
          recipient_name: 'Insurance Adjuster',
          subject: `Insurance Claim Report - ${job.insurance_claim_number || job.property_address}`,
          status: 'sent',
          resend_email_id: result.data?.id,
          sent_at: new Date().toISOString()
        });
      } catch (e) {
        adjusterError = e.message;
        console.error('❌ FAILED TO SEND EMAIL TO ADJUSTER:', e.message);
        console.error('Email error details:', e);
      }
    }

    // Send to production manager
    if (sendToProductionManager) {
      try {
        console.log('📧 Attempting to send to production manager...');
        const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: job.company_id });
        console.log(`Found ${allStaff.length} total staff members`);
        
        const productionManagers = allStaff.filter(s => s.role === 'production_manager' || s.department === 'production');
        console.log(`Found ${productionManagers.length} production managers:`, productionManagers.map(p => p.user_email));
        
        if (productionManagers.length === 0) {
          console.log('⚠️ No production managers found, skipping...');
        } else {
          for (const manager of productionManagers) {
            console.log('📧 Sending to production manager:', manager.user_email);
            await resend.emails.send({
              from: `${company?.company_name || 'Inspection Team'} <reports@mycrewcam.com>`,
              to: [manager.user_email],
              subject: `[Review Required] Inspection Report - ${job.property_address}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1e40af;">🔍 New Inspection Report for Review</h2>
                  <p>Hi ${manager.full_name},</p>
                  <p>A new inspection report is ready for your review:</p>
                  <ul style="line-height: 1.8;">
                    <li><strong>Property:</strong> ${job.property_address}</li>
                    <li><strong>Client:</strong> ${job.client_name}</li>
                    <li><strong>Inspector:</strong> ${job.assigned_to_name || 'Not assigned'}</li>
                    <li><strong>Date:</strong> ${new Date(job.inspection_date || job.created_date).toLocaleDateString()}</li>
                  </ul>
                  <p style="color: #666; font-size: 12px; margin-top: 30px;">Best regards,<br>${company?.company_name || 'Inspection Team'}</p>
                </div>
              `,
              attachments: [{
                filename: `Inspection_Report_${job.property_address?.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
                content: pdfBase64
              }]
            });
            console.log('✅ Sent to:', manager.user_email);
          }
          productionManagerSent = productionManagers.length > 0;
        }
      } catch (e) {
        console.error('❌ Failed to send to production manager:', e.message);
        console.error('Full error:', e);
      }
    }

    // Send to sales rep
    if (sendToSalesRep && job.sales_rep_email) {
      try {
        console.log('📧 Sending to sales rep:', job.sales_rep_email);
        await resend.emails.send({
          from: `${company?.company_name || 'Inspection Team'} <reports@mycrewcam.com>`,
          to: [job.sales_rep_email],
          subject: `Your Lead Inspection Complete - ${job.property_address}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e40af;">✅ Inspection Complete for Your Lead</h2>
              <p>The inspection report for <strong>${job.property_address}</strong> is ready.</p>
              <p>You can now follow up with ${job.client_name} and close the deal!</p>
              <p style="color: #666; font-size: 12px; margin-top: 30px;">Best regards,<br>${company?.company_name || 'Inspection Team'}</p>
            </div>
          `,
          attachments: [{
            filename: `Inspection_Report_${job.property_address?.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
            content: pdfBase64
          }]
        });
        salesRepSent = true;
        console.log('✅ Sent to sales rep');
      } catch (e) {
        console.error('❌ Failed to send to sales rep:', e.message);
        console.error('Full error:', e);
      }
    }

    // Send to custom emails
    if (sendToCustomEmails && customEmails) {
      try {
        const emails = customEmails.split(',').map(e => e.trim()).filter(Boolean);
        console.log('📧 Sending to custom recipients:', emails);
        
        if (emails.length === 0) {
          console.log('⚠️ No valid custom emails found');
        } else {
          for (const email of emails) {
            console.log('📧 Sending to:', email);
            await resend.emails.send({
              from: `${company?.company_name || 'Inspection Team'} <reports@mycrewcam.com>`,
              to: [email],
              subject: `Inspection Report - ${job.property_address}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1e40af;">📋 Inspection Report</h2>
                  <p>Please find attached the inspection report for <strong>${job.property_address}</strong>.</p>
                  <p style="color: #666; font-size: 12px; margin-top: 30px;">Best regards,<br>${company?.company_name || 'Inspection Team'}</p>
                </div>
              `,
              attachments: [{
                filename: `Inspection_Report_${job.property_address?.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
                content: pdfBase64
              }]
            });
            console.log('✅ Sent to:', email);
          }
          customSent = true;
          customCount = emails.length;
        }
      } catch (e) {
        console.error('❌ Failed to send to custom emails:', e.message);
        console.error('Full error:', e);
      }
    }

    // Notify all admins about report being sent
    try {
      const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: job.company_id });
      const admins = allStaff.filter(s => s.is_administrator === true);
      
      for (const admin of admins) {
        await base44.asServiceRole.entities.Notification.create({
          company_id: job.company_id,
          user_email: admin.user_email,
          title: '📧 Inspection Report Sent',
          message: `Report for ${job.property_address} was sent to: ${[
            clientSent ? 'Client' : null,
            adjusterSent ? 'Adjuster' : null,
            productionManagerSent ? 'Production Manager' : null,
            salesRepSent ? 'Sales Rep' : null,
            customSent ? `${customCount} custom recipient(s)` : null
          ].filter(Boolean).join(', ')}`,
          type: 'inspection_report_sent',
          related_entity_type: 'InspectionJob',
          related_entity_id: inspectionJobId,
          link_url: `/InspectionsDashboard?job=${inspectionJobId}`,
          is_read: false
        });
      }
      console.log(`✅ Notified ${admins.length} admin(s) about report being sent`);
    } catch (e) {
      console.error('⚠️ Failed to notify admins:', e.message);
    }

    console.log('🎉 Report process completed');
    console.log('Results:', {
      client: clientSent,
      adjuster: adjusterSent,
      productionManager: productionManagerSent,
      salesRep: salesRepSent,
      custom: customSent
    });
    
    const anySent = clientSent || adjusterSent || productionManagerSent || salesRepSent || customSent;
    
    // Return detailed status
    return Response.json({
      success: anySent,
      pdf_generated: true,
      client_sent: clientSent,
      adjuster_sent: adjusterSent,
      production_manager_sent: productionManagerSent,
      sales_rep_sent: salesRepSent,
      custom_sent: customSent,
      custom_count: customCount,
      client_error: clientError,
      adjuster_error: adjusterError,
      message: anySent ? 'Report sent successfully' : 'No recipients selected or available'
    });

  } catch (error) {
    console.error('❌ === CRITICAL ERROR IN SEND REPORT ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    return Response.json({ 
      success: false,
      error: error.message || 'Unknown error occurred',
      errorType: error.name || 'Error',
      stack: error.stack,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});