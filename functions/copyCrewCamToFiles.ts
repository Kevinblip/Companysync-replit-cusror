import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { customer_id, customer_name } = await req.json();

    if (!customer_id) {
      return Response.json({ error: 'customer_id is required' }, { status: 400 });
    }

    // Get customer for company_id
    const customers = await base44.entities.Customer.filter({ id: customer_id });
    if (customers.length === 0) {
      return Response.json({ error: 'Customer not found' }, { status: 404 });
    }
    const customer = customers[0];
    const company_id = customer.company_id;

    // Find inspection jobs for this customer
    const jobsByCustomerId = await base44.entities.InspectionJob.filter({ related_customer_id: customer_id });
    const jobsByCustomerName = await base44.entities.InspectionJob.filter({ client_name: customer.name });
    
    const jobs = [...jobsByCustomerId, ...jobsByCustomerName];
    const uniqueJobs = jobs.filter((job, idx, self) => idx === self.findIndex(j => j.id === job.id));

    if (uniqueJobs.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No inspection jobs found for this customer',
        files_created: 0 
      });
    }

    // Get all media for these jobs
    const jobIds = uniqueJobs.map(j => j.id);
    const allMedia = [];
    for (const jobId of jobIds) {
      const jobMedia = await base44.entities.JobMedia.filter({ 
        related_entity_id: jobId,
        related_entity_type: 'InspectionJob'
      });
      allMedia.push(...jobMedia);
    }
    const media = allMedia;

    if (media.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No media files found in inspections',
        files_created: 0 
      });
    }

    // Create Document records for each media file (photos + reports)
    const documentsToCreate = media.map(m => {
      const fileName = m.file_name || '';
      const fileUrl = m.file_url || '';
      const isReport = m.file_type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
      
      // Detect image type from file extension or URL
      let detectedType = m.file_type;
      if (!detectedType || detectedType === 'application/octet-stream') {
        const ext = fileName.toLowerCase().split('.').pop() || fileUrl.split('.').pop() || '';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
          detectedType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        }
      }
      
      return {
        company_id: company_id,
        document_name: fileName || (isReport ? 'CrewCam Report' : 'CrewCam Photo'),
        file_url: fileUrl,
        file_size: m.file_size || 0,
        file_type: detectedType || (isReport ? 'application/pdf' : 'image/jpeg'),
        category: isReport ? 'inspection_report' : 'inspection',
        related_customer: customer.name,
        related_entity_id: customer_id,
        description: `${isReport ? 'CrewCam inspection report' : 'CrewCam photo'} from inspection job`,
        is_customer_visible: true
      };
    });

    const created = await base44.entities.Document.bulkCreate(documentsToCreate);

    return Response.json({ 
      success: true, 
      message: `Added ${created.length} CrewCam photos to ${customer.name}'s files`,
      files_created: created.length 
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});