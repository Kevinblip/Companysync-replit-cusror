import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, photoUrl, uploadedBy, uploaderName } = await req.json();

    if (!jobId) {
      return Response.json({ success: false, error: 'jobId required' }, { status: 400 });
    }

    // Get the inspection job details
    const jobs = await base44.asServiceRole.entities.InspectionJob.filter({ id: jobId });
    const job = jobs[0];

    if (!job) {
      return Response.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    // Get all staff profiles to determine roles
    const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({
      company_id: job.company_id || user.company_id
    });

    // Determine who should be notified
    const notifyEmails = new Set();

    // 1. Add all admins
    allStaff.forEach(staff => {
      if (staff.role === 'admin' || staff.is_admin) {
        notifyEmails.add(staff.user_email);
      }
    });

    // 2. Add production managers
    allStaff.forEach(staff => {
      if (staff.role === 'production_manager' || staff.department === 'production') {
        notifyEmails.add(staff.user_email);
      }
    });

    // 3. Add assigned inspector
    if (job.assigned_to_email) {
      notifyEmails.add(job.assigned_to_email);
    }

    // 4. Add sales rep who owns the lead
    if (job.sales_rep_email) {
      notifyEmails.add(job.sales_rep_email);
    }

    // Don't notify the person who uploaded
    notifyEmails.delete(uploadedBy);

    // Create notifications for each recipient
    const notifications = [];
    for (const email of notifyEmails) {
      const notification = await base44.asServiceRole.entities.Notification.create({
        user_email: email,
        type: 'inspection_photo_uploaded',
        title: '📸 New Inspection Photo',
        message: `${uploaderName} uploaded a photo for ${job.property_address}`,
        link_url: `/pages/InspectionsDashboard?job=${jobId}`,
        is_read: false,
        created_date: new Date().toISOString()
      });
      notifications.push(notification);
    }

    return Response.json({
      success: true,
      notifications_sent: notifications.length,
      recipients: Array.from(notifyEmails)
    });

  } catch (error) {
    console.error('Error in notifyPhotoUploaded:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});